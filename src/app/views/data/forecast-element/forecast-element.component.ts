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

interface IForecastElement { ProductID: string; ChannelID: string; LocationID: string; }
interface KeyTriplet { ProductID: string; ChannelID: string; LocationID: string; }
interface SearchResult { query: string; count: number; keys: KeyTriplet[]; }
interface SavedSearch { id?: number; name: string; query: string; created_at?: string; }

@Component({
  standalone: true,
  selector: 'app-forecast-element',
  templateUrl: 'forecast-element.component.html',
  styleUrls: ['forecast-element.component.scss'],
  imports: [
    CommonModule, ReactiveFormsModule, HttpClientModule,
    TextColorDirective, CardComponent, CardBodyComponent, CardHeaderComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective, TableDirective
  ]
})
export class ForecastElementComponent implements OnInit {
  private http: HttpClient = inject(HttpClient);
  private readonly API = 'http://127.0.0.1:8000/api'; // use '/api' if you have a proxy

  // Data
  forecastElements: IForecastElement[] = [];
  filteredUnits: IForecastElement[] = [];

  // Local filters (also used to build a backend query)
  productSearch = new FormControl('');
  channelSearch = new FormControl('');
  locationSearch = new FormControl('');

  // Saved searches
  savedSearches: SavedSearch[] = [];
  selectedSavedIndex = new FormControl<number>(-1);

  // UI state
  loading = false;
  errorMessage: string | null = null;

  // Pagination & sorting
  currentPage = 1;
  itemsPerPage = 20;
  totalPages = 1;
  sortColumn: keyof IForecastElement | '' = '';
  sortAsc = true;

  ngOnInit(): void {
    this.refreshSavedSearches();
    this.productSearch.valueChanges.subscribe(() => this.applyFilters());
    this.channelSearch.valueChanges.subscribe(() => this.applyFilters());
    this.locationSearch.valueChanges.subscribe(() => this.applyFilters());
  }

  // ----- Saved searches -----
  refreshSavedSearches() {
    this.http.get<SavedSearch[]>(`${this.API}/saved-searches`).subscribe({
      next: rows => { this.savedSearches = rows || []; },
      error: e => console.error('saved-searches failed', e)
    });
  }

  async loadFromSaved() {
    this.errorMessage = null;
    const idx = this.selectedSavedIndex.value ?? -1;
    if (idx < 0 || idx >= this.savedSearches.length) {
      this.errorMessage = 'Please choose a saved search.';
      return;
    }
    await this.runQuery(this.savedSearches[idx].query);
  }

  // ----- Typed backend search -----
  private buildQueryFromInputs(): string | null {
    const parts: string[] = [];
    const add = (field: string, val: string) => {
      let v = (val || '').trim();
      if (!v) return;
      if (!/[.*%]/.test(v)) v = `*${v}*`;
      if (/\s/.test(v)) v = `"${v}"`;
      parts.push(`${field}:${v}`);
    };
    add('productid', this.productSearch.value || '');
    add('channelid', this.channelSearch.value || '');
    add('locationid', this.locationSearch.value || '');
    return parts.length ? parts.join(' AND ') : null;
  }

  async runTypedSearch() {
    const q = this.buildQueryFromInputs();
    if (!q) { this.errorMessage = 'Enter at least one of Product/Channel/Location.'; return; }
    await this.runQuery(q);
  }

  // ----- Core: /api/search -> keys -----
  private async runQuery(q: string) {
    this.loading = true;
    this.errorMessage = null;
    this.forecastElements = [];
    this.filteredUnits = [];
    this.currentPage = 1;

    try {
      const params = new HttpParams().set('q', q).set('limit', 20000).set('offset', 0);
      const res = await firstValueFrom(this.http.get<SearchResult>(`${this.API}/search`, { params }));
      const keys = res?.keys ?? [];
      this.forecastElements = keys.map(k => ({ ProductID: k.ProductID, ChannelID: k.ChannelID, LocationID: k.LocationID }));
      this.filteredUnits = [...this.forecastElements];
      this.updatePagination();
      this.applyFilters();
    } catch (e: any) {
      console.error('ForecastElement search failed', e);
      this.errorMessage = e?.error?.detail || e?.message || 'Search failed.';
    } finally {
      this.loading = false;
    }
  }

  // ----- Local table features -----
  applyFilters() {
    const prod = (this.productSearch.value || '').trim().toLowerCase();
    const chan = (this.channelSearch.value || '').trim().toLowerCase();
    const loc  = (this.locationSearch.value  || '').trim().toLowerCase();

    this.filteredUnits = this.forecastElements.filter(u => {
      const m1 = !prod || u.ProductID.toLowerCase().includes(prod);
      const m2 = !chan || u.ChannelID.toLowerCase().includes(chan);
      const m3 = !loc  || u.LocationID.toLowerCase().includes(loc);
      return m1 && m2 && m3;
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
    if (!this.filteredUnits.length) return;
    const header = Object.keys(this.filteredUnits[0]);
    const rows = this.filteredUnits.map(row => header.map(f => `"${(row as any)[f]}"`).join(','));
    const csvContent = [header.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.setAttribute('download', 'Filtered_ForecastElement.csv');
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  sortBy(column: keyof IForecastElement) {
    if (this.sortColumn === column) this.sortAsc = !this.sortAsc;
    else { this.sortColumn = column; this.sortAsc = true; }

    this.filteredUnits.sort((a, b) => {
      const va = (a[column] as any)?.toLowerCase?.() ?? String(a[column] ?? '');
      const vb = (b[column] as any)?.toLowerCase?.() ?? String(b[column] ?? '');
      return this.sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }

  updatePagination() {
    this.totalPages = Math.max(1, Math.ceil(this.filteredUnits.length / this.itemsPerPage));
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
  }

  visiblePages(): number[] {
    const total = this.totalPages || 1;
    const current = Math.min(Math.max(this.currentPage, 1), total);
    const windowSize = 5;
    if (total <= windowSize) return Array.from({ length: total }, (_, i) => i + 1);
    let start = current - Math.floor(windowSize / 2);
    let end = current + Math.floor(windowSize / 2);
    if (start < 1) { start = 1; end = windowSize; }
    if (end > total) { end = total; start = total - windowSize + 1; }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  get paginatedData(): IForecastElement[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredUnits.slice(start, start + this.itemsPerPage);
  }

  setPage(page: number) {
    const total = Math.max(1, this.totalPages);
    this.currentPage = Math.min(Math.max(1, page), total);
  }

  pageRange(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }
}
