import { DOCUMENT, NgStyle, NgIf, NgFor, NgSwitch, NgClass } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import {
  ButtonDirective, CardBodyComponent, CardComponent, CardFooterComponent, CardHeaderComponent, ColComponent,
  RowComponent, TableDirective, TextColorDirective
} from '@coreui/angular';
import { IconDirective } from '@coreui/icons-angular';

interface IChannel {
  ChannelID: string;
  ChannelDescr: string;
  Level: string;
}

@Component({
  standalone: true,
  selector: 'app-channel',
  templateUrl: 'channel.component.html',
  styleUrls: ['channel.component.scss'],
  imports: [
    TextColorDirective, CardComponent, CardBodyComponent, CardHeaderComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective,
    NgIf, NgFor, NgClass, NgSwitch, NgStyle,
    ReactiveFormsModule, TableDirective, HttpClientModule
  ]
})
export class ChannelComponent implements OnInit {
  private http: HttpClient = inject(HttpClient);

  public channelData: IChannel[] = [];
  public filteredData: IChannel[] = [];
  public searchResults: IChannel[] = [];

  public searchField = new FormControl('ChannelID');
  public searchTerm = new FormControl('');

  public currentPage = 1;
  public itemsPerPage = 5;
  public totalPages = 1;

  public sortColumn: keyof IChannel | '' = '';
  public sortAsc: boolean = true;

  ngOnInit(): void {
    this.loadCSV();

    this.searchTerm.valueChanges.subscribe(term => {
      this.performSearch(term || '');
    });

    this.searchField.valueChanges.subscribe(() => {
      this.performSearch(this.searchTerm.value || '');
    });
  }

  loadCSV() {
    this.http.get('assets/data/Channel.csv', { responseType: 'text' }).subscribe(data => {
      const lines = data.split('\n');
      this.channelData = lines.slice(1)
        .map(line => line.trim())
        .filter(line => line)
        .map(line => {
          const cols = line.split(',');
          return {
            ChannelID: cols[0],
            ChannelDescr: cols[1],
            Level: cols[2]
          } as IChannel;
        });

      this.filteredData = []; // show nothing until filters/search used
    });
  }

  performSearch(term: string) {
    const field = this.searchField.value as keyof IChannel;
    const lowerTerm = term.toLowerCase();

    this.searchResults = this.channelData.filter(p =>
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
    link.setAttribute('download', 'Channel_Search_Results.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  sortBy(column: keyof IChannel) {
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

  get paginatedData(): IChannel[] {
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
