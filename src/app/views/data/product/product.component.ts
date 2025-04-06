import { DOCUMENT, NgStyle, NgIf, NgFor, NgSwitch, NgClass } from '@angular/common';
import { Component, DestroyRef, OnInit, Renderer2, inject, signal, WritableSignal, effect } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import {
  ButtonDirective, CardBodyComponent, CardComponent, CardFooterComponent, CardHeaderComponent, ColComponent,
  RowComponent, TableDirective, TextColorDirective
} from '@coreui/angular';
import { IconDirective } from '@coreui/icons-angular';

interface IProduct {
  ProductID: string;
  ProductDescr: string;
  Level: string;
  BusinessUnit: string;
  IsDailyForecastRequired: string;
  IsNew: string;
  ProductFamily: string;
}

@Component({
  standalone: true,
  selector: 'app-product',
  templateUrl: 'product.component.html',
  styleUrls: ['product.component.scss'],
  imports: [
    TextColorDirective, CardComponent, CardBodyComponent, CardHeaderComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective,
    NgIf, NgFor, NgClass, NgSwitch, NgStyle,
    ReactiveFormsModule, TableDirective, HttpClientModule
  ]
})
export class ProductComponent implements OnInit {
  private http: HttpClient = inject(HttpClient);

  public productData: IProduct[] = [];
  public filteredData: IProduct[] = [];

  public searchField = new FormControl('ProductID');
  public searchTerm = new FormControl('');
  public searchResults: IProduct[] = [];

  public selectedBusinessUnit = new FormControl('');
  public selectedIsNew = new FormControl('');

  public businessUnitList: string[] = [];
  public isNewList: string[] = [];

  public currentPage = 1;
  public itemsPerPage = 5;
  public totalPages = 1;

  public sortColumn: keyof IProduct | '' = '';
  public sortAsc: boolean = true;

  ngOnInit(): void {
    this.loadCSV();

    this.searchTerm.valueChanges.subscribe(term => {
      this.performSearch(term || '');
    });

    this.searchField.valueChanges.subscribe(() => {
      this.performSearch(this.searchTerm.value || '');
    });

    this.selectedBusinessUnit.valueChanges.subscribe(() => {
      this.applyDropdownFilters();
    });

    this.selectedIsNew.valueChanges.subscribe(() => {
      this.applyDropdownFilters();
    });
  }

  loadCSV() {
    this.http.get('assets/data/Product.csv', { responseType: 'text' }).subscribe(data => {
      const lines = data.split('\n');
      this.productData = lines.slice(1)
        .map(line => line.trim())
        .filter(line => line)
        .map(line => {
          const cols = line.split(',');
          return {
            ProductID: cols[0],
            ProductDescr: cols[1],
            Level: cols[2],
            BusinessUnit: cols[3],
            IsDailyForecastRequired: cols[4],
            IsNew: cols[5],
            ProductFamily: cols[6]
          } as IProduct;
        });

      this.businessUnitList = [...new Set(this.productData.map(p => p.BusinessUnit))];
      this.isNewList = [...new Set(this.productData.map(p => p.IsNew))];

      this.filteredData = [];

    });
  }

  applyDropdownFilters() {
    const bu = this.selectedBusinessUnit.value;
    const isNew = this.selectedIsNew.value;

    this.filteredData = this.productData.filter(p =>
      (!bu || p.BusinessUnit === bu) &&
      (!isNew || p.IsNew === isNew)
    );

    this.currentPage = 1;
    this.updatePagination();
  }

  performSearch(term: string) {
    const field = this.searchField.value as keyof IProduct;
    const lowerTerm = term.toLowerCase();

    this.searchResults = this.productData.filter(p =>
      p[field]?.toLowerCase().includes(lowerTerm)
    );

    this.sortColumn = '';
    this.currentPage = 1;
    this.updatePagination();
  }

  exportToCSV() {
    if (!this.searchResults.length) return;

    const header = Object.keys(this.searchResults[0]);
    const rows = this.searchResults.map(row =>
      header.map(field => `"${(row as any)[field]}"`).join(',')
    );

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
    if (this.sortColumn === column) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortColumn = column;
      this.sortAsc = true;
    }

    const data = this.searchTerm.value ? this.searchResults : this.filteredData;
    data.sort((a, b) => {
      const valA = a[column]?.toLowerCase() ?? '';
      const valB = b[column]?.toLowerCase() ?? '';
      return this.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }

  updatePagination() {
    const data = this.searchTerm.value ? this.searchResults : this.filteredData;
    this.totalPages = Math.ceil(data.length / this.itemsPerPage);
  }

  get paginatedData(): IProduct[] {
    const data = this.searchTerm.value ? this.searchResults : this.filteredData;
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return data.slice(start, start + this.itemsPerPage);
  }

  setPage(page: number) {
    this.currentPage = page;
  }

  pageRange(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }
}
