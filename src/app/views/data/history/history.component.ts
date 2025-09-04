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

/** --- View model used by your table (kept same fields as before) --- */
interface IHistory {
  ProductID: string;
  LocationID: string;
  ChannelID: string;
  Period: string;
  StartDate: string;
  EndDate: string;
  Qty: string;   // keep as string to match your existing sorting/export
  Type: string;
  Level: string;
}

@Component({
  standalone: true,
  selector: 'app-history',
  templateUrl: 'history.component.html',
  styleUrls: ['history.component.scss'],
  imports: [
    // ✅ CommonModule gives you *ngIf/*ngFor/ngClass/ngStyle etc. (fixes TS-991010)
    CommonModule,
    ReactiveFormsModule,
    HttpClientModule,

    // CoreUI components you already use
    TextColorDirective,
    CardComponent, CardBodyComponent, CardHeaderComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective, TableDirective
  ]
})
export class HistoryComponent implements OnInit {
  private http: HttpClient = inject(HttpClient);

  /** Set to '/api' if you use an Angular dev proxy; else keep absolute URL */
  private readonly API = 'http://127.0.0.1:8000/api';

  /** Data shown in the table */
  public historyData: IHistory[] = [];
  public filteredHistory: IHistory[] = [];

  /** Local filter inputs (kept from your original UI) */
  public productSearch = new FormControl('');
  public channelSearch = new FormControl('');
  public locationSearch = new FormControl('');

  /** Period/bucket selector (Daily/Weekly/Monthly) */
  public periodSelection = new FormControl<'Daily' | 'Weekly' | 'Monthly'>('Daily');

  /** Saved searches + selection */
  public savedSearches: SavedSearch[] = [];
  public selectedSavedIndex = new FormControl<number>(-1); // -1 means none selected

  /** UI state */
  public loading = false;
  public errorMessage: string | null = null;

  /** Pagination & sorting */
  public currentPage = 1;
  public itemsPerPage = 20;
  public totalPages = 1;

  public sortColumn: keyof IHistory | '' = '';
  public sortAsc: boolean = true;

  ngOnInit(): void {
    // Load saved searches list on page open
    this.refreshSavedSearches();

    // Re-load data if the bucket changes AND we already have a saved search selected
    this.periodSelection.valueChanges.subscribe(() => this.reloadWithSameQueryIfAny());

    // Local table filters
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

  /** Called by a "Load" button in your template */
  async loadFromSaved() {
    this.errorMessage = null;
    const idx = this.selectedSavedIndex.value ?? -1;
    if (idx < 0 || idx >= this.savedSearches.length) {
      this.errorMessage = 'Please choose a saved search first.';
      return;
    }
    const q = this.savedSearches[idx].query;
    await this.runQueryAndLoadHistory(q);
  }

  /** Re-run same query on bucket change (if a saved search is selected) */
  private async reloadWithSameQueryIfAny() {
    const idx = this.selectedSavedIndex.value ?? -1;
    if (idx >= 0 && idx < this.savedSearches.length) {
      await this.runQueryAndLoadHistory(this.savedSearches[idx].query, /*silentIfNoKeys*/ true);
    }
  }

  /** ---------- Core: run /api/search then load /api/history/{bucket}-by-keys ---------- */

  private bucketSlug(): 'daily' | 'weekly' | 'monthly' {
    const p = this.periodSelection.value;
    return p === 'Weekly' ? 'weekly' : p === 'Monthly' ? 'monthly' : 'daily';
  }

  private toIHistoryRows(rows: any[]): IHistory[] {
    return (rows || []).map(r => ({
      ProductID: String(r.ProductID ?? ''),
      ChannelID: String(r.ChannelID ?? ''),
      LocationID: String(r.LocationID ?? ''),
      Period: String(r.Period ?? ''),
      StartDate: String(r.StartDate ?? ''),
      EndDate: String(r.EndDate ?? ''),
      Qty: String(r.Qty ?? ''),  // keep as string for sorting/export compatibility
      Type: String(r.Type ?? ''),
      Level: String(r.Level ?? '')
    }));
  }

  private async runQueryAndLoadHistory(q: string, silentIfNoKeys = false) {
    this.loading = true;
    this.errorMessage = null;
    this.historyData = [];
    this.filteredHistory = [];
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

      // 2) Load history for the selected bucket
      const endpoint = `${this.API}/history/${this.bucketSlug()}-by-keys`;
      const rows = await firstValueFrom(
        this.http.post<any[]>(endpoint, { keys })
      );

      this.historyData = this.toIHistoryRows(rows || []);
      // show everything initially
      this.filteredHistory = [...this.historyData];
      this.updatePagination();
      // re-apply local text filters (if any)
      this.applyFilters();
    } catch (e: any) {
      this.errorMessage = e?.error?.detail || e?.message || 'Failed to load history.';
    } finally {
      this.loading = false;
    }
  }

  /** ---------- Local table features (kept from your original) ---------- */

  applyFilters() {
    const prod = this.productSearch.value?.trim().toLowerCase() || '';
    const chan = this.channelSearch.value?.trim().toLowerCase() || '';
    const loc = this.locationSearch.value?.trim().toLowerCase() || '';

    this.filteredHistory = this.historyData.filter(entry => {
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

  visiblePages(): number[] {
    const total = this.totalPages || 1;
    const current = Math.min(Math.max(this.currentPage, 1), total);
    const windowSize = 5;
  
    if (total <= windowSize) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
  
    let start = current - Math.floor(windowSize / 2);
    let end = current + Math.floor(windowSize / 2);
  
    if (start < 1) { start = 1; end = windowSize; }
    if (end > total) { end = total; start = total - windowSize + 1; }
  
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }
  
  exportToCSV() {
    if (!this.filteredHistory.length) return;

    const header = Object.keys(this.filteredHistory[0]);
    const rows = this.filteredHistory.map(row =>
      header.map(field => `"${(row as any)[field]}"`).join(',')
    );

    const csvContent = [header.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Filtered_History_${this.periodSelection.value}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  sortBy(column: keyof IHistory) {
    if (this.sortColumn === column) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortColumn = column;
      this.sortAsc = true;
    }

    this.filteredHistory.sort((a, b) => {
      const valA = (a[column] as any)?.toLowerCase?.() ?? String(a[column] ?? '');
      const valB = (b[column] as any)?.toLowerCase?.() ?? String(b[column] ?? '');
      return this.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }

  updatePagination() {
    this.totalPages = Math.max(1, Math.ceil(this.filteredHistory.length / this.itemsPerPage));
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
  }

  get paginatedData(): IHistory[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredHistory.slice(start, start + this.itemsPerPage);
  }

  setPage(page: number) {
    const total = Math.max(1, this.totalPages);
    this.currentPage = Math.min(Math.max(1, page), total);
  }
  
  pageRange(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }
}
