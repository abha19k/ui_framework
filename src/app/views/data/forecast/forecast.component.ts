import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule, HttpParams } from '@angular/common/http';
import {
  ButtonDirective, CardBodyComponent, CardComponent, CardFooterComponent, CardHeaderComponent, ColComponent,
  RowComponent, TableDirective, TextColorDirective
} from '@coreui/angular';
import { IconDirective } from '@coreui/icons-angular';
import { firstValueFrom } from 'rxjs';

/** --- Backend models --- */
interface KeyTriplet { ProductID: string; ChannelID: string; LocationID: string; }
interface SearchResult { query: string; count: number; keys: KeyTriplet[]; }
interface SavedSearch { id?: number; name: string; query: string; created_at?: string; }

/** --- View model (strings keep your existing sorting/export behavior) --- */
interface IForecast {
  ProductID: string;
  ChannelID: string;
  LocationID: string;
  Method: string;
  Period: string;
  StartDate: string;
  EndDate: string;
  Type: string;
  Qty: string;
  Level: string;
}

@Component({
  standalone: true,
  selector: 'app-forecast',
  templateUrl: 'forecast.component.html',
  styleUrls: ['forecast.component.scss'],
  imports: [
    CommonModule, ReactiveFormsModule, HttpClientModule,
    TextColorDirective,
    CardComponent, CardBodyComponent, CardHeaderComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective, TableDirective
  ]
})
export class ForecastComponent implements OnInit {
  private http: HttpClient = inject(HttpClient);

  /** Use '/api' if you run an Angular dev proxy; else keep absolute */
  private readonly API = 'http://127.0.0.1:8000/api';

  /** Data */
  public forecastData: IForecast[] = [];
  public filteredForecasts: IForecast[] = [];

  /** Local filters */
  public productSearch = new FormControl('');
  public channelSearch = new FormControl('');
  public locationSearch = new FormControl('');

  /** Period */
  public periodSelection = new FormControl<'Daily' | 'Weekly' | 'Monthly'>('Daily');

  /** Saved searches */
  public savedSearches: SavedSearch[] = [];
  public selectedSavedIndex = new FormControl<number>(-1);

  /** UI state */
  public loading = false;
  public errorMessage: string | null = null;

  /** Pagination & sorting */
  public currentPage = 1;
  public itemsPerPage = 5;
  public totalPages = 1;

  public sortColumn: keyof IForecast | '' = '';
  public sortAsc: boolean = true;

  ngOnInit(): void {
    this.refreshSavedSearches();

    // Re-run same query if bucket changes and a saved search is selected
    this.periodSelection.valueChanges.subscribe(() => this.reloadWithSameQueryIfAny());

    // Local filters
    this.productSearch.valueChanges.subscribe(() => this.applyFilters());
    this.channelSearch.valueChanges.subscribe(() => this.applyFilters());
    this.locationSearch.valueChanges.subscribe(() => this.applyFilters());
  }

  /** ---------- Saved searches ---------- */

  refreshSavedSearches() {
    this.http.get<SavedSearch[]>(`${this.API}/saved-searches`).subscribe({
      next: (rows) => { this.savedSearches = rows || []; },
      error: (e) => { console.error('saved-searches failed', e); }
    });
  }

  async loadFromSaved() {
    this.errorMessage = null;
    const idx = this.selectedSavedIndex.value ?? -1;
    if (idx < 0 || idx >= this.savedSearches.length) {
      this.errorMessage = 'Please choose a saved search first.';
      return;
    }
    const q = this.savedSearches[idx].query;
    await this.runQueryAndLoadForecast(q);
  }

  private async reloadWithSameQueryIfAny() {
    const idx = this.selectedSavedIndex.value ?? -1;
    if (idx >= 0 && idx < this.savedSearches.length) {
      await this.runQueryAndLoadForecast(this.savedSearches[idx].query, /*silentIfNoKeys*/ true);
    }
  }

  /** ---------- Core: /api/search → /api/forecast/{bucket}-by-keys ---------- */

  private bucketSlug(): 'daily' | 'weekly' | 'monthly' {
    const p = this.periodSelection.value;
    return p === 'Weekly' ? 'weekly' : p === 'Monthly' ? 'monthly' : 'daily';
  }

  private toIForecastRows(rows: any[]): IForecast[] {
    return (rows || []).map(r => ({
      ProductID: String(r.ProductID ?? ''),
      ChannelID: String(r.ChannelID ?? ''),
      LocationID: String(r.LocationID ?? ''),
      Method: String(r.Method ?? ''),
      Period: String(r.Period ?? ''),
      StartDate: String(r.StartDate ?? ''),
      EndDate: String(r.EndDate ?? ''),
      Type: String(r.Type ?? ''),
      Qty: String(r.Qty ?? ''),
      Level: String(r.Level ?? '')
    }));
  }

  private async runQueryAndLoadForecast(q: string, silentIfNoKeys = false) {
    this.loading = true;
    this.errorMessage = null;
    this.forecastData = [];
    this.filteredForecasts = [];
    this.currentPage = 1;

    try {
      // 1) Resolve keys via /api/search
      const params = new HttpParams().set('q', q).set('limit', 5000).set('offset', 0);
      const search = await firstValueFrom(
        this.http.get<SearchResult>(`${this.API}/search`, { params })
      );
      const keys = search?.keys ?? [];

      if (!keys.length) {
        if (!silentIfNoKeys) this.errorMessage = 'No matches for this saved query.';
        this.updatePagination();
        this.loading = false;
        return;
      }

      // 2) Load forecast rows for selected bucket
      const endpoint = `${this.API}/forecast/${this.bucketSlug()}-by-keys`;
      const rows = await firstValueFrom(
        this.http.post<any[]>(endpoint, { keys })
      );

      this.forecastData = this.toIForecastRows(rows || []);
      this.filteredForecasts = [...this.forecastData];
      this.updatePagination();
      this.applyFilters(); // re-apply local filters if any
    } catch (e: any) {
      this.errorMessage = e?.error?.detail || e?.message || 'Failed to load forecast.';
    } finally {
      this.loading = false;
    }
  }

  /** ---------- Local table features ---------- */

  applyFilters() {
    const prod = this.productSearch.value?.trim().toLowerCase() || '';
    const chan = this.channelSearch.value?.trim().toLowerCase() || '';
    const loc = this.locationSearch.value?.trim().toLowerCase() || '';

    this.filteredForecasts = this.forecastData.filter(entry => {
      const productMatch = !prod || entry.ProductID.toLowerCase().includes(prod);
      const channelMatch = !chan || entry.ChannelID.toLowerCase().includes(chan);
      const locationMatch = !loc || entry.LocationID.toLowerCase().includes(loc);
      return productMatch && channelMatch && locationMatch;
    });

    this.currentPage = 1;
    this.updatePagination();
  }

  clearAllFilters() {
    this.productSearch.setValue('');
    this.channelSearch.setValue('');
    this.locationSearch.setValue('');
  }

  exportToCSV() {
    if (!this.filteredForecasts.length) return;

    const header = Object.keys(this.filteredForecasts[0]);
    const rows = this.filteredForecasts.map(row =>
      header.map(field => `"${(row as any)[field]}"`).join(',')
    );

    const csvContent = [header.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Filtered_Forecast_${this.periodSelection.value}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  sortBy(column: keyof IForecast) {
    if (this.sortColumn === column) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortColumn = column;
      this.sortAsc = true;
    }

    this.filteredForecasts.sort((a, b) => {
      const valA = (a[column] as any)?.toLowerCase?.() ?? String(a[column] ?? '');
      const valB = (b[column] as any)?.toLowerCase?.() ?? String(b[column] ?? '');
      return this.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }

  updatePagination() {
    this.totalPages = Math.max(1, Math.ceil(this.filteredForecasts.length / this.itemsPerPage));
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
  }

  get paginatedData(): IForecast[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredForecasts.slice(start, start + this.itemsPerPage);
  }

  // Clamp page to [1, totalPages]
  setPage(page: number) {
    const total = Math.max(1, this.totalPages);
    this.currentPage = Math.min(Math.max(1, page), total);
  }

  // Sliding 5-page window for the pager (used by the HTML)
  visiblePages(): number[] {
    const total = this.totalPages || 1;
    const current = Math.min(Math.max(this.currentPage, 1), total);
    const windowSize = 5;

    if (total <= windowSize) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    let start = current - Math.floor(windowSize / 2);
    let end = start + windowSize - 1;

    if (start < 1) { start = 1; end = windowSize; }
    if (end > total) { end = total; start = Math.max(1, total - windowSize + 1); }

    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  // Kept for compatibility (not used by the new pager)
  pageRange(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }
}
