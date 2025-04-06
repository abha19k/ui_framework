import { DOCUMENT, NgStyle, NgIf, NgFor, NgSwitch, NgClass } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import {
  ButtonDirective, CardBodyComponent, CardComponent, CardFooterComponent, CardHeaderComponent, ColComponent,
  RowComponent, TableDirective, TextColorDirective
} from '@coreui/angular';
import { IconDirective } from '@coreui/icons-angular';

interface IDemandUnit {
  ProductID: string;
  ChannelID: string;
  LocationID: string;
}

@Component({
  standalone: true,
  selector: 'app-demand-unit',
  templateUrl: 'demand-unit.component.html',
  styleUrls: ['demand-unit.component.scss'],
  imports: [
    TextColorDirective, CardComponent, CardBodyComponent, CardHeaderComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective,
    NgIf, NgFor, NgClass, NgSwitch, NgStyle,
    ReactiveFormsModule, TableDirective, HttpClientModule
  ]
})
export class DemandUnitComponent implements OnInit {
  private http: HttpClient = inject(HttpClient);

  public demandUnits: IDemandUnit[] = [];
  public filteredUnits: IDemandUnit[] = [];

  public productSearch = new FormControl('');
  public channelSearch = new FormControl('');
  public locationSearch = new FormControl('');

  public currentPage = 1;
  public itemsPerPage = 5;
  public totalPages = 1;

  public sortColumn: keyof IDemandUnit | '' = '';
  public sortAsc: boolean = true;

  ngOnInit(): void {
    this.loadCSV();

    this.productSearch.valueChanges.subscribe(() => this.applyFilters());
    this.channelSearch.valueChanges.subscribe(() => this.applyFilters());
    this.locationSearch.valueChanges.subscribe(() => this.applyFilters());
  }

  loadCSV() {
    this.http.get('assets/data/DemandUnit.csv', { responseType: 'text' }).subscribe(data => {
      const lines = data.split('\n');
      this.demandUnits = lines.slice(1)
        .map(line => line.trim())
        .filter(line => line)
        .map(line => {
          const cols = line.split('\t'); // tab-separated
          return {
            ProductID: cols[0],
            ChannelID: cols[1],
            LocationID: cols[2]
          } as IDemandUnit;
        });

      this.filteredUnits = []; // only show after filtering
      this.updatePagination();
    });
  }

  applyFilters() {
    const prod = this.productSearch.value?.trim().toLowerCase();
    const chan = this.channelSearch.value?.trim().toLowerCase();
    const loc = this.locationSearch.value?.trim().toLowerCase();

    const allEmpty = !prod && !chan && !loc;

    this.filteredUnits = this.demandUnits.filter(unit =>
      (allEmpty || (
        (!prod || unit.ProductID.toLowerCase().includes(prod)) &&
        (!chan || unit.ChannelID.toLowerCase().includes(chan)) &&
        (!loc || unit.LocationID.toLowerCase().includes(loc))
      ))
    );

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
    const rows = this.filteredUnits.map(row =>
      header.map(field => `"${(row as any)[field]}"`).join(',')
    );

    const csvContent = [header.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Filtered_DemandUnits.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  sortBy(column: keyof IDemandUnit) {
    if (this.sortColumn === column) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortColumn = column;
      this.sortAsc = true;
    }

    this.filteredUnits.sort((a, b) => {
      const valA = a[column]?.toLowerCase() ?? '';
      const valB = b[column]?.toLowerCase() ?? '';
      return this.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }

  updatePagination() {
    this.totalPages = Math.ceil(this.filteredUnits.length / this.itemsPerPage);
  }

  get paginatedData(): IDemandUnit[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredUnits.slice(start, start + this.itemsPerPage);
  }

  setPage(page: number) {
    this.currentPage = page;
  }

  pageRange(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }
}
