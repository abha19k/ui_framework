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

interface IProduct {
  ProductID: string;
  ProductDescr: string;
  Level: string;
  BusinessUnit: string;
  IsDailyForecastRequired: string;
  IsNew: string;
  ProductFamily: string;
}

interface KeyTriplet { ProductID: string; ChannelID: string; LocationID: string; }
interface SearchResult { query: string; count: number; keys: KeyTriplet[]; }
interface SavedSearch { id?: number; name: string; query: string; created_at?: string; }

@Component({
  standalone: true,
  selector: 'app-product',
  templateUrl: 'product.component.html',
  styleUrls: ['product.component.scss'],
  imports: [
    CommonModule, ReactiveFormsModule, HttpClientModule,
    TextColorDirective, CardComponent, CardBodyComponent, CardHeaderComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective, TableDirective
  ]
})
export class ProductComponent implements OnInit {
  private http: HttpClient = inject(HttpClient);
  private readonly API = 'http://127.0.0.1:8000/api';

  /** All products (loaded once), search results, and filtered view */
  public productData: IProduct[] = [];
  public searchResults: IProduct[] = [];
  public filteredData: IProduct[] = [];

  /** Typed search inputs */
  public searchField = new FormControl<'ProductID' | 'ProductDescr' | 'Level' | 'BusinessUnit' | 'IsDailyForecastRequired' | 'IsNew' | 'ProductFamily'>('ProductID');
  public searchTerm = new FormControl('');

  /** Saved searches */
  public savedSearches: SavedSearch[] = [];
  public selectedSavedIndex = new FormControl<number>(-1);

  /** Optional dropdown filters */
  public selectedBusinessUnit = new FormControl('');
  public selectedIsNew = new FormControl('');
  public businessUnitList: string[] = [];
  public isNewList: string[] = [];

  /** UI state */
  public loading = false;
  public errorMessage: string | null = null;

  /** Pagination & sorting */
  public currentPage = 1;
  public itemsPerPage = 5;
  public totalPages = 1;
  public sortColumn: keyof IProduct | '' = '';
  public sortAsc: boolean = true;

  ngOnInit(): void {
    this.loadProducts();
    this.refreshSavedSearches();

    this.searchTerm.valueChanges.subscribe(term => this.performSearch(term || ''));
    this.searchField.valueChanges.subscribe(() => this.performSearch(this.searchTerm.value || ''));

    this.selectedBusinessUnit.valueChanges.subscribe(() => this.applyDropdownFilters());
    this.selectedIsNew.valueChanges.subscribe(() => this.applyDropdownFilters());
  }

  /** Load all products from backend once */
  private loadProducts() {
    this.loading = true;
    this.http.get<IProduct[]>(`${this.API}/products`).subscribe({
      next: rows => {
        this.productData = (rows || []).map(p => ({
          ProductID: String(p.ProductID ?? ''),
          ProductDescr: String(p.ProductDescr ?? ''),
          Level: String((p as any).Level ?? ''),
          BusinessUnit: String(p.BusinessUnit ?? ''),
          IsDailyForecastRequired: String((p as any).IsDailyForecastRequired ?? ''),
          IsNew: String((p as any).IsNew ?? ''),
          ProductFamily: String(p.ProductFamily ?? '')
        }));
        this.businessUnitList = [...new Set(this.productData.map(p => p.BusinessUnit).filter(Boolean))].sort();
        this.isNewList = [...new Set(this.productData.map(p => p.IsNew).filter(Boolean))].sort();
        this.searchResults = [];
        this.filteredData = [];
        this.updatePagination();
      },
      error: err => {
        console.error('GET /products failed', err);
        this.errorMessage = 'Failed to load products.';
      },
      complete: () => { this.loading = false; }
    });
  }

  /** Saved searches */
  refreshSavedSearches() {
    this.http.get<SavedSearch[]>(`${this.API}/saved-searches`).subscribe({
      next: (rows) => { this.savedSearches = rows || []; },
      error: (e) => { console.error('saved-searches failed', e); }
    });
  }

  private savedQueryHasProductField(q: string): boolean {
    const s = (q || '').toLowerCase();
    return ['productid:', 'productdescr:', 'businessunit:', 'isdailyforecastrequired:', 'isnew:', 'productfamily:', 'productlevel:']
      .some(tag => s.includes(tag));
  }

  async loadFromSaved() {
    this.errorMessage = null;
    const idx = this.selectedSavedIndex.value ?? -1;
    if (idx < 0 || idx >= this.savedSearches.length) {
      this.errorMessage = 'Please choose a saved search.';
      return;
    }
    const q = this.savedSearches[idx].query;
    if (!this.savedQueryHasProductField(q)) {
      this.errorMessage = 'This saved search does not include product attributes. Product page only runs searches with product fields.';
      this.searchResults = [];
      this.applyDropdownFilters();
      return;
    }
    await this.runQueryAndFilterProducts(q);
  }

  /** Map UI field to backend field name used by /api/search */
  private backendFieldFor(uiField: string): string | null {
    switch ((uiField || '').toLowerCase()) {
      case 'productid': return 'productid';
      case 'productdescr': return 'productdescr';
      case 'businessunit': return 'businessunit';
      case 'isdailyforecastrequired': return 'isdailyforecastrequired';
      case 'isnew': return 'isnew';
      case 'productfamily': return 'productfamily';
      case 'level': return 'productlevel'; // backend expects productlevel
      default: return null;
    }
  }

  private buildProductQuery(fieldUI: string, term: string): string | null {
    const field = this.backendFieldFor(fieldUI);
    if (!field) return null;
    let value = (term || '').trim();
    if (!value) return null;
    if (!/[.*%]/.test(value)) value = `*${value}*`; // add wildcards if none
    if (/\s/.test(value)) value = `"${value}"`;     // quote if spaces
    return `${field}:${value}`;
  }

  /** Typed search → backend keys → filter products */
  async performSearch(term: string) {
    this.errorMessage = null;
    if (!term?.trim()) {
      this.searchResults = [];
      this.applyDropdownFilters();
      return;
    }
    const q = this.buildProductQuery(this.searchField.value || 'ProductID', term);
    if (!q) {
      this.errorMessage = 'Please choose a valid product attribute.';
      this.searchResults = [];
      this.applyDropdownFilters();
      return;
    }
    await this.runQueryAndFilterProducts(q);
  }

  private async runQueryAndFilterProducts(q: string) {
    this.loading = true;
    try {
      const params = new HttpParams().set('q', q).set('limit', 20000).set('offset', 0);
      const res = await firstValueFrom(
        this.http.get<SearchResult>(`${this.API}/search`, { params })
      );
      const keys = res?.keys ?? [];
      if (!keys.length) {
        this.searchResults = [];
        this.applyDropdownFilters();
        return;
      }
      const allowed = new Set(keys.map(k => k.ProductID));
      this.searchResults = this.productData.filter(p => allowed.has(p.ProductID));
      this.applyDropdownFilters();
    } catch (e: any) {
      console.error('Product search failed', e);
      this.errorMessage = e?.error?.detail || e?.message || 'Search failed.';
      this.searchResults = [];
      this.applyDropdownFilters();
    } finally {
      this.loading = false;
    }
  }

  /** Dropdown filters on top of search results */
  applyDropdownFilters() {
    const bu = (this.selectedBusinessUnit.value || '').trim();
    const isNew = (this.selectedIsNew.value || '').trim();

    const base = this.searchResults; // show only after a search
    this.filteredData = base.filter(p =>
      (!bu || p.BusinessUnit === bu) &&
      (!isNew || p.IsNew === isNew)
    );

    this.currentPage = 1;
    this.updatePagination();
  }

  exportToCSV() {
    const data = this.filteredData;
    if (!data.length) return;

    const header = Object.keys(data[0]);
    const rows = data.map(row => header.map(field => `"${(row as any)[field]}"`).join(','));
    const csvContent = [header.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Product_Search_Results.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  sortBy(column: keyof IProduct) {
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

  get paginatedData(): IProduct[] {
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
