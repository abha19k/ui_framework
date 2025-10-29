import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule, HttpParams } from '@angular/common/http';
import {
  CardComponent, CardHeaderComponent, CardBodyComponent, CardFooterComponent,
  RowComponent, ColComponent, ButtonDirective, TextColorDirective, TableDirective
} from '@coreui/angular';
import { IconDirective } from '@coreui/icons-angular';
import { firstValueFrom } from 'rxjs';

/** --- Backend contracts --- */
interface KeyTriplet { ProductID: string; ChannelID: string; LocationID: string; }
interface SearchResult { query: string; count: number; keys: KeyTriplet[]; }
interface SavedSearch { id?: number; name: string; query: string; created_at?: string; }

interface ClassificationRow {
  ProductID: string;
  ChannelID: string;
  LocationID: string;
  periods: number;
  nonzero_count: number;
  adi: number | null;
  cv2: number | null;
  category: 'Smooth' | 'Intermittent' | 'Erratic' | 'Sparse' | 'NotEnoughHistory';
  seasonal?: boolean | null;
}

type PeriodView = 'Daily' | 'Weekly' | 'Monthly';
type Algo = 'HoltWinters' | 'XGBoost' | 'MovingAverage' | 'Croston' | 'ARIMA' | 'ETS';

@Component({
  standalone: true,
  selector: 'app-classify-forecast-elements',
  templateUrl: './classify-forecast-elements.component.html',
  styleUrls: ['./classify-forecast-elements.component.scss'],
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule, HttpClientModule,
    TextColorDirective, TableDirective,
    CardComponent, CardHeaderComponent, CardBodyComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective
  ]
})
export class ClassifyForecastElementsComponent implements OnInit {
  /** Services */
  private http = inject(HttpClient);
  private fb   = inject(FormBuilder);

  /** API base (adjust if you use Angular proxy) */
  readonly API = 'http://127.0.0.1:8000/api';

  /** Saved-search selection -> keys */
  savedSearches: SavedSearch[] = [];
  selectedSavedIndex = new FormControl<number>(-1, { nonNullable: true });
  periodSelection   = new FormControl<PeriodView>('Daily', { nonNullable: true });

  /** UI state */
  loading = false;
  errorMsg: string | null = null;

  /** Save state */
  saving = false;
  saveMsg: string | null = null;
  saveErr: string | null = null;

  /** Results */
  rows: ClassificationRow[] = [];

  /** Settings form */
  form: FormGroup = this.fb.group({
    /** Mutually exclusive: default to Automated */
    autoEnabled:   this.fb.control<boolean>(true,  { nonNullable: true }),
    manualEnabled: this.fb.control<boolean>(false, { nonNullable: true }),

    /** Automated selection (defaults to XGBoost as requested) */
    autoLookback:  this.fb.control<number>(12, { nonNullable: true, validators: [Validators.min(1)] }),
    autoAlgo:      this.fb.control<Algo>('XGBoost', { nonNullable: true }),

    /** Manual mapping: one algorithm per category */
    manual: this.fb.group({
      Smooth:           this.fb.control<Algo>('HoltWinters',   { nonNullable: true }),
      Intermittent:     this.fb.control<Algo>('XGBoost',       { nonNullable: true }),
      Erratic:          this.fb.control<Algo>('XGBoost',       { nonNullable: true }),
      Sparse:           this.fb.control<Algo>('MovingAverage', { nonNullable: true }),
      NotEnoughHistory: this.fb.control<Algo>('XGBoost',       { nonNullable: true }),
    })
  });

  /** Options for dropdowns */
  readonly algoOptions: Algo[] = ['XGBoost','HoltWinters','MovingAverage','Croston','ARIMA','ETS'];

  /** Keep auto/manual exclusive */
  ngOnInit(): void {
    this.refreshSavedSearches();

    this.form.get('autoEnabled')!.valueChanges.subscribe(v => {
      if (v) this.form.get('manualEnabled')!.setValue(false, { emitEvent: false });
      else if (!this.form.get('manualEnabled')!.value) this.form.get('manualEnabled')!.setValue(true, { emitEvent: false });
    });
    this.form.get('manualEnabled')!.valueChanges.subscribe(v => {
      if (v) this.form.get('autoEnabled')!.setValue(false, { emitEvent: false });
      else if (!this.form.get('autoEnabled')!.value) this.form.get('autoEnabled')!.setValue(true, { emitEvent: false });
    });
  }

  /** Handle saved-search <select> that uses [(ngModel)] in HTML */
  onSavedSearchChanged(val: any) {
    const n = typeof val === 'string' ? parseInt(val, 10) : Number(val);
    this.selectedSavedIndex.setValue(Number.isFinite(n) ? n : -1);
  }

  /** Load list of saved searches */
  refreshSavedSearches() {
    this.http.get<SavedSearch[]>(`${this.API}/saved-searches`).subscribe({
      next: rows => this.savedSearches = rows || [],
      error: ()   => this.savedSearches = []
    });
  }

  /** Run: resolve keys from saved search then classify (using Cleansed-History only) */
  async runClassification() {
    this.errorMsg = null;
    this.saveMsg = this.saveErr = null;
    this.rows = [];
    const idx = this.selectedSavedIndex.value ?? -1;
    if (idx < 0 || idx >= this.savedSearches.length) {
      this.errorMsg = 'Please select a saved search.';
      return;
    }

    const q = this.savedSearches[idx].query;
    const params = new HttpParams().set('q', q).set('limit', 20000).set('offset', 0);

    this.loading = true;
    try {
      // 1) keys from /api/search (from ForecastElement universe)
      const sr = await firstValueFrom(this.http.get<SearchResult>(`${this.API}/search`, { params }));
      const keys = sr?.keys ?? [];
      if (!keys.length) {
        this.errorMsg = 'No matches for this saved query.';
        return;
      }

      // 2) classify using Cleansed-History only
      const payload = {
        period: this.periodSlug(),
        keys,
        min_nonzero: 6,
        /** pass selection settings so backend can honor them (future-proof) */
        mode: this.form.get('autoEnabled')!.value ? 'auto' : 'manual',
        auto: {
          lookback: this.form.get('autoLookback')!.value,
          algo: this.form.get('autoAlgo')!.value as Algo,   // defaults to XGBoost
        },
        manual: this.form.get('manual')!.value as Record<string, Algo>
      };

      const rows = await firstValueFrom(
        this.http.post<ClassificationRow[]>(`${this.API}/classify/compute`, payload)
      );
      this.rows = rows ?? [];

      if (!this.rows.length) {
        this.errorMsg = 'No Cleansed-History found for these keys. Please run Cleanse History first.';
      }
    } catch (e: any) {
      this.errorMsg = e?.error?.detail || e?.message || 'Failed to classify.';
    } finally {
      this.loading = false;
    }
  }

  /** Save computed rows to the backend so the Data page can read them */
  async saveResults() {
    this.saveMsg = this.saveErr = null;

    if (!this.rows.length) {
      this.saveErr = 'Nothing to save. Run classification first.';
      return;
    }

    const payload = {
      period: this.periodSlug(),
      rows: this.rows.map(r => ({
        ProductID: r.ProductID,
        ChannelID: r.ChannelID,
        LocationID: r.LocationID,
        ADI: r.adi,
        CV2: r.cv2,
        Category: r.category,
        Algorithm: this.chosenAlgo(r.category),  // uses autoAlgo or manual mapping
      }))
    };

    this.saving = true;
    try {
      const res = await firstValueFrom(
        this.http.post<{ ok: boolean; count: number }>(`${this.API}/classify/save`, payload)
      );
      this.saveMsg = `Saved ${res?.count ?? payload.rows.length} result(s).`;
    } catch (e: any) {
      this.saveErr = e?.error?.detail || e?.message || 'Failed to save results.';
    } finally {
      this.saving = false;
    }
  }

  /** period label → backend slug */
  private periodSlug(): 'daily' | 'weekly' | 'monthly' {
    const p = this.periodSelection.value;
    return p === 'Weekly' ? 'weekly' : p === 'Monthly' ? 'monthly' : 'daily';
  }

  /** What algorithm will be used for a category (for display & saving) */
  chosenAlgo(category: ClassificationRow['category']): string {
    if (this.form.get('manualEnabled')!.value) {
      const m = this.form.get('manual')!.value as Record<string, Algo>;
      return m[category] ?? '(none)';
    }
    return this.form.get('autoAlgo')!.value as string; // Automated → XGBoost by default
  }
}
