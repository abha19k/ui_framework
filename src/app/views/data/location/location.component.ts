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

interface ILocation {
  LocationID: string;
  LocationDescr: string;
  Level: string;
  Geography: string;
}

interface KeyTriplet { ProductID: string; ChannelID: string; LocationID: string; }
interface SearchResult { query: string; count: number; keys: KeyTriplet[]; }
interface SavedSearch { id?: number; name: string; query: string; created_at?: string; }

@Component({
  standalone: true,
  selector: 'app-location',
  templateUrl: 'location.component.html',
  styleUrls: ['location.component.scss'],
  imports: [
    CommonModule, ReactiveFormsModule, HttpClientModule,
    TextColorDirective, CardComponent, CardBodyComponent, CardHeaderComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective, TableDirective
  ]
})
export class LocationComponent implements OnInit {
  private http: HttpClient = inject(HttpClient);
  private readonly API = 'http://127.0.0.1:8000/api';

  // Data
  public locationData: ILocation[] = [];
  public searchResults: ILocation[] = [];
  public filteredData: ILocation[] = [];

  // Typed search
  public searchField = new FormControl<'LocationID' | 'LocationDescr' | 'Level' | 'Geography'>('LocationID');
  public searchTerm = new FormControl('');

  // Saved searches
  public savedSearches: SavedSearch[] = [];
  public selectedSavedIndex = new FormControl<number>(-1);

  // UI state
  public loading = false;
  public errorMessage: string | null = null;

  // Pagination & sorting
  public currentPage = 1;
  public itemsPerPage = 5;
  public totalPages = 1;
  public sortColumn: keyof ILocation | '' = '';
  public sortAsc: boolean = true;

  ngOnInit(): void {
    this.loadLocations();
    this.refreshSavedSearches();

    this.searchTerm.valueChanges.subscribe(term => this.performSearch(term || ''));
    this.searchField.valueChanges.subscribe(() => this.performSearch(this.searchTerm.value || ''));
  }

  /** Load location master from backend */
  private loadLocations() {
    this.loading = true;
    this.http.get<any[]>(`${this.API}/locations`).subscribe({
      next: rows => {
        this.locationData = (rows || []).map(l => ({
          LocationID: String(l.LocationID ?? ''),
          LocationDescr: String(l.LocationDescr ?? ''),
          Level: String(l.Level ?? ''),
          Geography: String(l.Geography ?? '')
        }));
        this.searchResults = [];
        this.filteredData = [];
        this.updatePagination();
      },
      error: err => {
        console.error('GET /locations failed', err);
        this.errorMessage = 'Failed to load locations.';
      },
      complete: () => { this.loading = false; }
    });
  }

  exportToCSV() {
    // Prefer filtered results if present; otherwise fall back to full dataset
    const data = this.filteredData?.length ? this.filteredData : this.locationData;
    if (!data || !data.length) return;
  
    const header = Object.keys(data[0] as any);
    const rows = data.map(row =>
      header.map(field => {
        const cell = (row as any)[field] ?? '';
        // Escape quotes and wrap each cell
        const escaped = String(cell).replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(',')
    );
  
    const csv = [header.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
  
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Location_Search_Results.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  /** Saved searches list */
  refreshSavedSearches() {
    this.http.get<SavedSearch[]>(`${this.API}/saved-searches`).subscribe({
      next: rows => { this.savedSearches = rows || []; },
      error: e => { console.error('saved-searches failed', e); }
    });
  }

  /** Only run saved searches that include location attributes */
  private savedQueryHasLocationField(q: string): boolean {
    const s = (q || '').toLowerCase();
    return ['locationid:', 'locationdescr:', 'locationlevel:', 'geography:'].some(tag => s.includes(tag));
  }

  async loadFromSaved() {
    this.errorMessage = null;
    const idx = this.selectedSavedIndex.value ?? -1;
    if (idx < 0 || idx >= this.savedSearches.length) {
      this.errorMessage = 'Please choose a saved search.';
      return;
    }
    const q = this.savedSearches[idx].query;
    if (!this.savedQueryHasLocationField(q)) {
      this.errorMessage = 'This saved search does not include location attributes. The Location page only runs searches with location fields.';
      this.searchResults = [];
      this.filteredData = [];
      this.updatePagination();
      return;
    }
    await this.runQueryAndFilterLocations(q);
  }

  /** Map UI field to backend field used by /api/search */
  private backendFieldFor(uiField: string): string | null {
    switch ((uiField || '').toLowerCase()) {
      case 'locationid': return 'locationid';
      case 'locationdescr': return 'locationdescr';
      case 'level': return 'locationlevel'; // backend expects 'locationlevel'
      case 'geography': return 'geography';
      default: return null;
    }
  }

  private buildLocationQuery(fieldUI: string, term: string): string | null {
    const field = this.backendFieldFor(fieldUI);
    if (!field) return null;
    let value = (term || '').trim();
    if (!value) return null;
    if (!/[.*%]/.test(value)) value = `*${value}*`; // add wildcards
    if (/\s/.test(value)) value = `"${value}"`;     // quote if spaces
    return `${field}:${value}`;
  }

  /** Typed search → backend keys → filter locations by LocationID */
  async performSearch(term: string) {
    this.errorMessage = null;
    if (!term?.trim()) {
      this.searchResults = [];
      this.filteredData = [];
      this.updatePagination();
      return;
    }
    const q = this.buildLocationQuery(this.searchField.value || 'LocationID', term);
    if (!q) {
      this.errorMessage = 'Please choose a valid location attribute.';
      this.searchResults = [];
      this.filteredData = [];
      this.updatePagination();
      return;
    }
    await this.runQueryAndFilterLocations(q);
  }

  private async runQueryAndFilterLocations(q: string) {
    this.loading = true;
    try {
      const params = new HttpParams().set('q', q).set('limit', 20000).set('offset', 0);
      const res = await firstValueFrom(
        this.http.get<SearchResult>(`${this.API}/search`, { params })
      );
      const keys = res?.keys ?? [];
      if (!keys.length) {
        this.searchResults = [];
        this.filteredData = [];
        this.updatePagination();
        return;
      }
      const allowed = new Set(keys.map(k => k.LocationID));
      this.searchResults = this.locationData.filter(l => allowed.has(l.LocationID));
      this.filteredData = [...this.searchResults];
      this.currentPage = 1;
      this.updatePagination();
    } catch (e: any) {
      console.error('Location search failed', e);
      this.errorMessage = e?.error?.detail || e?.message || 'Search failed.';
      this.searchResults = [];
      this.filteredData = [];
      this.updatePagination();
    } finally {
      this.loading = false;
    }
  }

  /** Sorting + pagination */
  sortBy(column: keyof ILocation) {
    if (this.sortColumn === column) this.sortAsc = !this.sortAsc;
    else { this.sortColumn = column; this.sortAsc = true; }

    this.filteredData.sort((a, b) => {
      const valA = (a[column] as any)?.toLowerCase?.() ?? String(a[column] ?? '');
      const valB = (b[column] as any)?.toLowerCase?.() ?? String(b[column] ?? '');
      return this.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }

  updatePagination() {
    this.totalPages = Math.max(1, Math.ceil(this.filteredData.length / this.itemsPerPage));
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
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

  get paginatedData(): ILocation[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredData.slice(start, start + this.itemsPerPage);
  }

  setPage(page: number) {
    const total = Math.max(1, this.totalPages);
    this.currentPage = Math.min(Math.max(1, page), total);
  }

  pageRange(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }
}
