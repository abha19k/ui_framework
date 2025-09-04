import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { SearchService } from '../../services/search.service';

type Domain = 'product' | 'channel' | 'location';
type Op = 'AND' | 'OR';

interface FieldOption {
  key: string;   // must match backend FIELD_MAP key
  label: string; // user-friendly label
  domain: Domain;
}

interface Criterion {
  key: string;     // e.g. "businessunit"
  value: string;   // e.g. "Fast Food"
  op?: Op;         // operator placed BEFORE this item (ignored for the first)
}

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './search.component.html'
})
export default class SearchComponent implements OnInit {
  private http = inject(HttpClient);
  private svc = inject(SearchService);

  // Absolute URL (your Option 1). If you use a dev proxy, you can switch to '/api'
  private API = 'http://127.0.0.1:8000/api';

  // Dropdown field choices
  readonly fields: FieldOption[] = [
    // Product
    { key: 'productid', label: 'Product ID', domain: 'product' },
    { key: 'productdescr', label: 'Product Description', domain: 'product' },
    { key: 'businessunit', label: 'Business Unit', domain: 'product' },
    { key: 'isdailyforecastrequired', label: 'Is Daily Forecast Required', domain: 'product' },
    { key: 'isnew', label: 'Is New', domain: 'product' },
    { key: 'productfamily', label: 'Product Family', domain: 'product' },
    { key: 'productlevel', label: 'Product Level', domain: 'product' },

    // Channel
    { key: 'channelid', label: 'Channel ID', domain: 'channel' },
    { key: 'channeldescr', label: 'Channel Description', domain: 'channel' },
    { key: 'channellevel', label: 'Channel Level', domain: 'channel' },

    // Location
    { key: 'locationid', label: 'Location ID', domain: 'location' },
    { key: 'locationdescr', label: 'Location Description', domain: 'location' },
    { key: 'locationlevel', label: 'Location Level', domain: 'location' },
    { key: 'geography', label: 'Geography', domain: 'location' },
  ];

  // UI state
  domain = signal<Domain>('product');
  fieldKey = signal<string>('businessunit');
  fieldValues = signal<string[]>([]);
  selectedValue = signal<string>('');
  nextOp = signal<Op>('AND');

  // Built criteria
  criteria = signal<Criterion[]>([]);

  // Save
  saveName = signal<string>('');
  saving = signal(false);
  error = signal<string | null>(null);
  savedOk = signal(false);

  // Source data for values
  products: any[] = [];
  channels: any[] = [];
  locations: any[] = [];

  ngOnInit() {
    // load values for dropdowns
    this.http.get<any[]>(`${this.API}/products`).subscribe(p => { this.products = p; this.refreshFieldValues(); });
    this.http.get<any[]>(`${this.API}/channels`).subscribe(c => { this.channels = c; this.refreshFieldValues(); });
    this.http.get<any[]>(`${this.API}/locations`).subscribe(l => { this.locations = l; this.refreshFieldValues(); });
  }

  onDomainChange(newDom: Domain) {
    this.domain.set(newDom);
    const firstField = this.fields.find(f => f.domain === newDom)?.key ?? '';
    this.fieldKey.set(firstField);
    this.refreshFieldValues();
  }

  onFieldChange(newKey: string) {
    this.fieldKey.set(newKey);
    this.refreshFieldValues();
  }

  refreshFieldValues() {
    const key = this.fieldKey();
    const dom = this.domain();
    const uniq = new Set<string>();

    const push = (v: any) => {
      if (v === null || v === undefined) return;
      const s = String(v);
      if (s.trim().length) uniq.add(s);
    };

    const fromProducts = () => {
      for (const r of this.products) {
        switch (key) {
          case 'productid': push(r.ProductID); break;
          case 'productdescr': push(r.ProductDescr); break;
          case 'businessunit': push(r.BusinessUnit); break;
          case 'isdailyforecastrequired': push(r.IsDailyForecastRequired); break;
          case 'isnew': push(r.IsNew); break;
          case 'productfamily': push(r.ProductFamily); break;
          case 'productlevel': push(r.Level); break;
        }
      }
    };

    const fromChannels = () => {
      for (const r of this.channels) {
        switch (key) {
          case 'channelid': push(r.ChannelID); break;
          case 'channeldescr': push(r.ChannelDescr); break;
          case 'channellevel': push(r.Level); break;
        }
      }
    };

    const fromLocations = () => {
      for (const r of this.locations) {
        switch (key) {
          case 'locationid': push(r.LocationID); break;
          case 'locationdescr': push(r.LocationDescr); break; // aliased in your API
          case 'locationlevel': push(r.Level); break;
          case 'geography': push(r.Geography); break;
        }
      }
    };

    if (dom === 'product') fromProducts();
    if (dom === 'channel') fromChannels();
    if (dom === 'location') fromLocations();

    const arr = Array.from(uniq).sort((a, b) => a.localeCompare(b));
    this.fieldValues.set(arr);
    this.selectedValue.set(arr[0] ?? '');
  }

  addCriterion() {
    const key = this.fieldKey();
    const value = this.selectedValue().trim();
    if (!key || !value) return;

    const exists = this.criteria().some(c => c.key === key && c.value === value);
    if (!exists) {
      const op = this.nextOp(); // operator to place BEFORE this new criterion
      this.criteria.update(list => [...list, { key, value, op }]);
    }
  }

  removeCriterion(i: number) {
    this.criteria.update(list => list.filter((_, idx) => idx !== i));
  }

  setOp(i: number, op: Op) {
    this.criteria.update(list => list.map((c, idx) => (idx === i ? { ...c, op } : c)));
  }

  private quoteIfNeeded(v: string): string {
    return /[\s:"]/g.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
  }

  // Compose query with operators
  builtQuery = computed(() => {
    const parts: string[] = [];
    const cs = this.criteria();
    cs.forEach((c, i) => {
      const token = `${c.key}:${this.quoteIfNeeded(c.value)}`;
      if (i === 0) parts.push(token);
      else parts.push((c.op ?? 'AND').toUpperCase(), token);
    });
    return parts.join(' ');
  });

  async save() {
    this.error.set(null);
    this.savedOk.set(false);
    const name = this.saveName().trim();
    const query = this.builtQuery().trim();

    if (!name) { this.error.set('Please enter a name.'); return; }
    if (!query) { this.error.set('Please add at least one criterion.'); return; }

    this.saving.set(true);
    try {
      await this.svc.save({ name, query }).toPromise();
      this.savedOk.set(true);
      // Optionally clear after save:
      // this.criteria.set([]); this.saveName.set('');
    } catch (e: any) {
      this.error.set(e?.error?.detail || e?.message || 'Save failed');
    } finally {
      this.saving.set(false);
    }
  }
}
