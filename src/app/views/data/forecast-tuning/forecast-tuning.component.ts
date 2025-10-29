import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, ElementRef, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule, HttpParams } from '@angular/common/http';
import {
  ButtonDirective, CardBodyComponent, CardComponent, CardFooterComponent, CardHeaderComponent,
  ColComponent, RowComponent, TableDirective, TextColorDirective
} from '@coreui/angular';
import { IconDirective } from '@coreui/icons-angular';
import { firstValueFrom } from 'rxjs';
import Chart from 'chart.js/auto';

interface ISeriesPoint { StartDate: string; Qty: number; }
interface ISaved { id: number; name: string; query: string; created_at?: string; }
interface IKey { ProductID: string; ChannelID: string; LocationID: string; }

interface ITuneRow {
  lag: number;
  params: Record<string, any>;
  features: Record<string, any>;
  MAE: number; RMSE: number; MAPE: number; sMAPE: number; WAPE: number;
}
interface ITuneResult {
  tried: number;
  results?: ITuneRow[];
  best?: ITuneRow | null;
}

@Component({
  standalone: true,
  selector: 'app-forecast-tuning',
  templateUrl: 'forecast-tuning.component.html',
  styleUrls: ['forecast-tuning.component.scss'],
  imports: [
    CommonModule, ReactiveFormsModule, HttpClientModule,
    TextColorDirective, CardComponent, CardBodyComponent, CardHeaderComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective, TableDirective
  ]
})
export class ForecastTuningComponent implements OnInit, OnDestroy {
  private http: HttpClient = inject(HttpClient);
  private readonly API = 'http://127.0.0.1:8000/api';

  // ---------- Filters (single-key) ----------
  productIdCtrl = new FormControl<string>('');
  channelIdCtrl = new FormControl<string>('');
  locationIdCtrl = new FormControl<string>('');
  periodSelection = new FormControl<'Daily' | 'Weekly' | 'Monthly'>('Daily');

  // ---------- Saved searches (query mode) ----------
  savedSearches: ISaved[] = [];
  savedSearchId = new FormControl<number | null>(null);
  queryCtrl = new FormControl<string>('');
  newSavedName = new FormControl<string>('');

  // ---------- Tuning ----------
  lagCtrl = new FormControl<number>(3);
  horizonCtrl = new FormControl<number>(12);
  foldsCtrl = new FormControl<number>(3);
  useCleansedCtrl = new FormControl<boolean>(false);

  xgbParamsForm = new FormGroup({
    n_estimators:        new FormControl<number | null>(400),
    learning_rate:       new FormControl<number | null>(0.05),
    max_depth:           new FormControl<number | null>(5),
    subsample:           new FormControl<number | null>(0.9),
    colsample_bytree:    new FormControl<number | null>(0.8),
    reg_lambda:          new FormControl<number | null>(1.0),
    // optional extras (leave null to omit)
    reg_alpha:           new FormControl<number | null>(null),
    min_child_weight:    new FormControl<number | null>(null),
    gamma:               new FormControl<number | null>(null),
  });

  xgbFeaturesForm = new FormGroup({
    seasonal_lags:       new FormControl<string>(''),
    rolling_windows:     new FormControl<string>(''),
    use_log1p:           new FormControl<boolean>(true),
    two_stage:           new FormControl<boolean>(false),
    zero_prob_threshold: new FormControl<number | null>(0.5),
  });

  // ---------- Options ----------
  productIds: string[] = [];
  channelIds: string[] = [];
  locationIds: string[] = [];

  // ---------- UI state ----------
  loading = false;
  errorMessage: string | null = null;
  metrics: Record<string, number> | null = null;
  tuneResult: ITuneResult | null = null;

  // ---------- Chart ----------
  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;

  // ---------- Colors ----------
  private readonly COLORS = {
    history:        '#2563eb', // blue
    forecastSaved:  '#ef4444', // red
    forecastKey:    '#f59e0b', // amber
    forecastQuery:  '#10b981', // green
  };

  // Defaults per period (used by the button)
  setDefaultsForPeriod(p: 'Daily' | 'Weekly' | 'Monthly') {
    if (p === 'Daily') {
      this.lagCtrl.setValue(14);
      this.xgbFeaturesForm.patchValue({
        seasonal_lags: '7,14,28',
        rolling_windows: '7,28',
        use_log1p: true,
        two_stage: false
      });
    } else if (p === 'Weekly') {
      this.lagCtrl.setValue(13);
      this.xgbFeaturesForm.patchValue({
        seasonal_lags: '52',
        rolling_windows: '4,13',
        use_log1p: true,
        two_stage: false
      });
    } else {
      this.lagCtrl.setValue(6);
      this.xgbFeaturesForm.patchValue({
        seasonal_lags: '12,24',
        rolling_windows: '3,6',
        use_log1p: true,
        two_stage: false
      });
    }
  }

  // translucent helper
  private hexA(hex: string, a = 0.15) {
    const h = hex.replace('#','');
    const n = parseInt(h, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  async ngOnInit(): Promise<void> {
    await this.loadDropdownOptions();
    await this.loadSavedSearches();
  }
  ngOnDestroy(): void { this.destroyChart(); }

  // ---------------- Helpers ----------------
  private uniqSort(arr: string[]): string[] {
    return Array.from(new Set(arr)).sort((a, b) => String(a).localeCompare(String(b)));
  }

  private paramsValue(): any {
    const v = this.xgbParamsForm.value as Record<string, any>;
    return Object.fromEntries(Object.entries(v).filter(([, val]) => val !== null && val !== undefined));
  }

  private featuresValue(periodSlug: 'daily'|'weekly'|'monthly'): any {
    const v = this.xgbFeaturesForm.value as Record<string, any>;
    const parseNums = (s?: string | null) =>
      (s ?? '').split(',').map(x => x.trim()).filter(Boolean).map(Number).filter(n => !Number.isNaN(n));
    const defaults = periodSlug === 'daily'
      ? { seasonal_lags:[7,14,28], rolling_windows:[7,28] }
      : periodSlug === 'weekly'
      ? { seasonal_lags:[52], rolling_windows:[4,13] }
      : { seasonal_lags:[12,24], rolling_windows:[3,6] };
    const seasonal = parseNums(v['seasonal_lags']);
    const rolling  = parseNums(v['rolling_windows']);
    return {
      seasonal_lags: seasonal.length ? seasonal : defaults.seasonal_lags,
      rolling_windows: rolling.length ? rolling : defaults.rolling_windows,
      use_log1p: !!v['use_log1p'],
      two_stage: !!v['two_stage'],
      zero_prob_threshold: (v['zero_prob_threshold'] ?? 0.5),
    };
  }

  private periodSlug(): 'daily'|'weekly'|'monthly' {
    return this.periodSelection.value === 'Weekly' ? 'weekly'
         : this.periodSelection.value === 'Monthly' ? 'monthly' : 'daily';
  }

  private buildQueryFromFilters(): string {
    const tokens: string[] = [];
    const p = (this.productIdCtrl.value || '').trim();
    const c = (this.channelIdCtrl.value || '').trim();
    const l = (this.locationIdCtrl.value || '').trim();
    if (p) tokens.push(`productid:${p}`);
    if (c) tokens.push(`channelid:${c}`);
    if (l) tokens.push(`locationid:${l}`);
    return tokens.join(' ');
  }

  // ---------------- Data loading ----------------
  private async loadDropdownOptions() {
    this.loading = true; this.errorMessage = null;
    try {
      const [prods, chans, locs] = await Promise.all([
        firstValueFrom(this.http.get<any[]>(`${this.API}/products`)),
        firstValueFrom(this.http.get<any[]>(`${this.API}/channels`)),
        firstValueFrom(this.http.get<any[]>(`${this.API}/locations`)),
      ]);
      this.productIds  = this.uniqSort((prods || []).map(p => String(p.ProductID ?? '')).filter(Boolean));
      this.channelIds  = this.uniqSort((chans || []).map(c => String(c.ChannelID ?? '')).filter(Boolean));
      this.locationIds = this.uniqSort((locs || []).map(l => String(l.LocationID ?? '')).filter(Boolean));
    } catch (err) {
      console.error(err);
      this.errorMessage = 'Failed to load dropdown options.';
    } finally { this.loading = false; }
  }

  // --- PLOTS (Monthly batch script outputs) ---
  private safeKey(pid: string, cid: string, lid: string): string {
    // matches safe_key() in your Python: keep spaces, replace illegal file chars with "_"
    const raw = `${pid} | ${cid} | ${lid}`;
    return raw.replace(/[\\/*?:"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  }

  plotUrlBacktestForCurrent(): string | null {
    const k = this.requireKey(); if (!k) return null;
    const sk = this.safeKey(k.ProductID, k.ChannelID, k.LocationID);
    const path = `backtest/backtest_${sk}.png`;
    return `http://127.0.0.1:8000/plots/${encodeURIComponent(path)}?t=${Date.now()}`;
  }

  plotUrlHistoryForecastForCurrent(): string | null {
    const k = this.requireKey(); if (!k) return null;
    const sk = this.safeKey(k.ProductID, k.ChannelID, k.LocationID);
    const path = `history_plus_forecast/history_forecast_${sk}.png`;
    return `http://127.0.0.1:8000/plots/${encodeURIComponent(path)}?t=${Date.now()}`;
  }

  // Optional: trigger the monthly batch script from UI so plots/CSVs are generated
  async runMonthlyBatchOnce() {
    this.loading = true; this.errorMessage = null;
    try {
      await firstValueFrom(this.http.post(`${this.API}/batch/monthly/run`, {}));
      // After it finishes, the <img> tags will display via the URLs above.
    } catch (e: any) {
      console.error(e);
      this.errorMessage = e?.error?.detail || 'Batch run failed.';
    } finally {
      this.loading = false;
    }
  }

  private async loadSavedSearches() {
    try {
      const list = await firstValueFrom(this.http.get<ISaved[]>(`${this.API}/saved-searches`));
      this.savedSearches = list || [];
    } catch (e) {
      console.error(e);
    }
  }

  onSavedSearchChange() {
    const id = this.savedSearchId.value;
    const found = this.savedSearches.find(s => s.id === id!);
    this.queryCtrl.setValue(found?.query ?? '');
  }

  async saveCurrentAsSearch() {
    const name = (this.newSavedName.value || '').trim();
    if (!name) { this.errorMessage = 'Enter a name to save the search.'; return; }

    const q = (this.queryCtrl.value || '').trim() || this.buildQueryFromFilters();
    if (!q) { this.errorMessage = 'Nothing to save — set filters or enter a query.'; return; }

    this.loading = true; this.errorMessage = null;
    try {
      await firstValueFrom(this.http.post(`${this.API}/saved-searches`, { name, query: q }));
      this.newSavedName.setValue('');
      await this.loadSavedSearches();
    } catch (e) {
      console.error(e);
      this.errorMessage = 'Failed to save search.';
    } finally { this.loading = false; }
  }

  // ---------------- History + Forecast (single-key) ----------------
  async updatePlot() {
    this.errorMessage = null;
    const q = this.buildQueryFromFilters();
    if (!q) {
      this.errorMessage = 'Select at least one of ProductID, ChannelID, or LocationID.';
      this.destroyChart();
      return;
    }

    const bucket = this.periodSlug();
    const params = new HttpParams().set('q', q).set('max_points', '800');

    this.loading = true;
    try {
      const [hist, fc] = await Promise.all([
        firstValueFrom(this.http.get<ISeriesPoint[]>(`${this.API}/history/${bucket}-series-by-query`, { params })),
        this.fetchForecastSeries(bucket, q),
      ]);

      if (!hist?.length && !fc?.length) {
        this.errorMessage = 'No data for this selection.'; this.destroyChart(); return;
      }

      const base = hist?.length ? hist : fc!;
      const baseColor = hist?.length ? this.COLORS.history : this.COLORS.forecastSaved;

      this.drawChart(
        base.map(s => s.StartDate),
        base.map(s => s.Qty),
        hist?.length ? 'History (Key)' : 'Forecast (Saved, Key)',
        baseColor
      );

      if (hist?.length && fc?.length) {
        this.addDatasetAlignedStyled(
          fc.map(s => s.StartDate),
          fc.map(s => s.Qty),
          'Forecast (Saved, Key)',
          {
            borderDash: [6, 3],
            pointRadius: 1,
            borderColor: this.COLORS.forecastSaved,
            backgroundColor: this.COLORS.forecastSaved,
            pointBackgroundColor: this.COLORS.forecastSaved,
          }
        );
      }
    } catch (err) {
      console.error(err);
      this.errorMessage = 'Failed to load series.';
      this.destroyChart();
    } finally { this.loading = false; }
  }

  // ---------------- History + Forecast (query) ----------------
  async loadHistoryForQuery() {
    this.errorMessage = null;
    const q = (this.queryCtrl.value || '').trim();
    if (!q) { this.errorMessage = 'This saved search has no query.'; return; }

    const bucket = this.periodSlug();
    const params = new HttpParams().set('q', q).set('max_points', '800');
    this.loading = true;
    try {
      const [hist, fc] = await Promise.all([
        firstValueFrom(this.http.get<ISeriesPoint[]>(`${this.API}/history/${bucket}-series-by-query`, { params })),
        this.fetchForecastSeries(bucket, q),
      ]);

      if (!hist?.length && !fc?.length) {
        this.errorMessage = 'No data for this query.'; this.destroyChart(); return;
      }

      const base = hist?.length ? hist : fc!;
      const baseColor = hist?.length ? this.COLORS.history : this.COLORS.forecastSaved;

      this.drawChart(
        base.map(d=>d.StartDate),
        base.map(d=>d.Qty),
        hist?.length ? 'History (Query)' : 'Forecast (Saved, Query)',
        baseColor
      );

      if (hist?.length && fc?.length) {
        this.addDatasetAlignedStyled(
          fc.map(d=>d.StartDate),
          fc.map(d=>d.Qty),
          'Forecast (Saved, Query)',
          {
            borderDash: [6,3],
            pointRadius: 1,
            borderColor: this.COLORS.forecastSaved,
            backgroundColor: this.COLORS.forecastSaved,
            pointBackgroundColor: this.COLORS.forecastSaved,
          }
        );
      }
    } catch (e) {
      console.error(e);
      this.errorMessage = 'Failed to load query series.';
      this.destroyChart();
    } finally { this.loading = false; }
  }

  // ---------------- Forecast / Backtest (single key) ----------------
  private requireKey(): IKey | null {
    const p = (this.productIdCtrl.value || '').trim();
    const c = (this.channelIdCtrl.value || '').trim();
    const l = (this.locationIdCtrl.value || '').trim();
    if (!p || !c || !l) { this.errorMessage = 'Pick ProductID, ChannelID and LocationID to run single-key ops.'; return null; }
    return { ProductID: p, ChannelID: c, LocationID: l };
  }

  async runSingleKeyForecast(save: boolean) {
    this.errorMessage = null;
    const k = this.requireKey(); if (!k) return;

    const period = this.periodSlug();
    const lag = this.lagCtrl.value ?? 3;
    const horizon = this.horizonCtrl.value ?? 12;
    const params = this.paramsValue();
    const features = this.featuresValue(period);
    const use_cleansed = this.useCleansedCtrl.value ?? false;
    const color = save ? this.COLORS.forecastSaved : this.COLORS.forecastKey;

    this.loading = true;
    try {
      const body = { period, key: k, horizon, lag, use_cleansed, save, use_generated_periods: true, params, features };
      const res: any = await firstValueFrom(this.http.post(`${this.API}/forecast/xgb/run`, body));
      const preds = (res?.predictions || []) as Array<{ StartDate: string; Qty: number }>;
      if (!preds.length) { this.errorMessage = 'No forecast produced.'; return; }
      const labels = preds.map(p => p.StartDate);
      const values = preds.map(p => p.Qty);

      if (!this.chart) this.drawChart(labels, [], '');
      this.addDatasetAlignedStyled(labels, values,
        save ? 'Forecast (Saved, Key)' : 'Forecast (Key)',
        {
          borderDash: [2,2],
          pointRadius: 2,
          borderColor: color,
          backgroundColor: color,
          pointBackgroundColor: color,
        }
      );
    } catch (e) {
      console.error(e);
      this.errorMessage = 'Failed to run single-key forecast.';
    } finally { this.loading = false; }
  }

  async runBacktest() {
    this.errorMessage = null; this.metrics = null;
    const k = this.requireKey(); if (!k) return;

    const period = this.periodSlug();
    const lag = this.lagCtrl.value ?? 3;
    const horizon = this.horizonCtrl.value ?? 12;
    const folds = this.foldsCtrl.value ?? 3;
    const params = this.paramsValue();
    const features = this.featuresValue(period);
    const use_cleansed = this.useCleansedCtrl.value ?? false;

    this.loading = true;
    try {
      const body = { period, key: k, horizon, lag, folds, use_cleansed, params, features };
      const res: any = await firstValueFrom(this.http.post(`${this.API}/forecast/xgb/backtest`, body));
      this.metrics = res?.metrics || null;
    } catch (e) {
      console.error(e);
      this.errorMessage = 'Backtest failed (not enough history?)';
    } finally { this.loading = false; }
  }

  async tuneXgb() {
    this.errorMessage = null; this.tuneResult = null;
    const k = this.requireKey(); if (!k) return;

    const period = this.periodSlug();
    const horizon = this.horizonCtrl.value ?? 12;
    const folds = this.foldsCtrl.value ?? 3;
    const use_cleansed = this.useCleansedCtrl.value ?? false;

    this.loading = true;
    try {
      const body = { period, key: k, horizon, folds, use_cleansed };
      this.tuneResult = await firstValueFrom(this.http.post<ITuneResult>(`${this.API}/forecast/xgb/tune`, body));
    } catch (e) {
      console.error(e);
      this.errorMessage = 'Tune failed.';
    } finally {
      this.loading = false;
    }
  }

  applyBestFromTune() {
    const b = this.tuneResult?.best; if (!b) return;

    const currParams = this.xgbParamsForm.value as Record<string, any>;
    this.lagCtrl.setValue(b.lag);

    this.xgbParamsForm.patchValue({
      n_estimators:      b.params?.['n_estimators']      ?? currParams['n_estimators'],
      learning_rate:     b.params?.['learning_rate']     ?? currParams['learning_rate'],
      max_depth:         b.params?.['max_depth']         ?? currParams['max_depth'],
      subsample:         b.params?.['subsample']         ?? currParams['subsample'],
      colsample_bytree:  b.params?.['colsample_bytree']  ?? currParams['colsample_bytree'],
      reg_lambda:        b.params?.['reg_lambda']        ?? currParams['reg_lambda'],
      reg_alpha:         b.params?.['reg_alpha']         ?? currParams['reg_alpha'],
      min_child_weight:  b.params?.['min_child_weight']  ?? currParams['min_child_weight'],
      gamma:             b.params?.['gamma']             ?? currParams['gamma'],
    });

    const toCsv = (a: any) => Array.isArray(a) ? a.join(',') : '';
    this.xgbFeaturesForm.patchValue({
      seasonal_lags:         toCsv(b.features?.['seasonal_lags']),
      rolling_windows:       toCsv(b.features?.['rolling_windows']),
      use_log1p:           !!(b.features?.['use_log1p']),
      two_stage:           !!(b.features?.['two_stage']),
      zero_prob_threshold:   b.features?.['zero_prob_threshold'] ?? (this.xgbFeaturesForm.value as any)['zero_prob_threshold']
    });
  }

  // ---------------- Chart helpers ----------------
  private destroyChart() {
    if (this.chart) { this.chart.destroy(); this.chart = null; }
  }

  private yTickFormat(this: any, tickValue: string | number): string {
    const n = Number(tickValue);
    if (!isFinite(n)) return String(tickValue);
    return n.toLocaleString();
  }

  private computeYScale(values: number[]) {
    const { min, max } = this.extent(values);
    return {
      type: 'linear' as const,
      beginAtZero: false,
      suggestedMin: min,
      suggestedMax: max,
      ticks: { callback: this.yTickFormat as any }
    };
  }

  private drawChart(labels: string[], values: number[], label = 'Qty', color?: string) {
    this.destroyChart();
    const ctx = this.chartCanvas?.nativeElement?.getContext('2d');
    if (!ctx) return;

    const lineColor = color ?? this.COLORS.history;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: values.length ? [{
          label,
          data: values,
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.2,
          borderColor: lineColor,
          backgroundColor: this.hexA(lineColor, 0.15),
          pointBackgroundColor: lineColor,
          fill: true
        }] : []
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true }, tooltip: { enabled: true } },
        scales: {
          x: { title: { display: true, text: 'Start Date' } },
          y: this.computeYScale(values)
        }
      }
    });
  }

  private extent(values: Array<number | null | undefined>) {
    const nums = (values || []).filter(v => typeof v === 'number' && isFinite(v)) as number[];
    const min = nums.length ? Math.min(...nums) : 0;
    const max = nums.length ? Math.max(...nums) : 1;
    if (max === min) { return { min: Math.max(0, min - 1), max: max + 1 }; }
    const pad = 0.08 * (max - min);
    return { min: Math.max(0, min - pad), max: max + pad };
  }

  private yScaleFromAllDatasets(extra?: number[]) {
    const dsVals: number[] = [];
    if (this.chart?.data?.datasets?.length) {
      this.chart.data.datasets.forEach(ds => {
        (ds.data as any[] || []).forEach(v => { if (typeof v === 'number' && isFinite(v)) dsVals.push(v); });
      });
    }
    if (extra?.length) dsVals.push(...extra.filter(x => typeof x === 'number') as number[]);
    return this.computeYScale(dsVals);
  }

  private addDatasetAlignedStyled(
    newLabels: string[],
    newValues: number[],
    datasetLabel: string,
    style: Partial<Chart['data']['datasets'][number]> = {}
  ) {
    if (!this.chart) { this.drawChart(newLabels, newValues, datasetLabel); return; }

    const currentLabels = (this.chart.data.labels as string[]) || [];
    const mergedSet = new Set<string>([...currentLabels, ...newLabels]);
    const mergedLabels = Array.from(mergedSet).sort();

    const mapTo = (labels: string[], values: number[], all: string[]) => {
      const idx = new Map(labels.map((l, i) => [l, i]));
      return all.map(l => {
        const i = idx.get(l);
        return i === undefined ? null : values[i];
      });
    };

    const remappedExisting = (this.chart.data.datasets || []).map(ds => {
      const dsVals = (ds.data as (number|null)[]) || [];
      return { ds, vals: mapTo(currentLabels, dsVals as number[], mergedLabels) };
    });
    const newVals = mapTo(newLabels, newValues, mergedLabels);

    this.chart.data.labels = mergedLabels;
    remappedExisting.forEach(({ ds, vals }) => ds.data = vals);
    this.chart.data.datasets.push({
      label: datasetLabel,
      data: newVals,
      borderWidth: 2,
      tension: 0.2,
      pointRadius: 0,
      ...style
    });

    const yScale = this.yScaleFromAllDatasets();
    (this.chart.options.scales as any).y = yScale;

    this.chart.update();
  }

  private async fetchForecastSeries(bucket: 'daily'|'weekly'|'monthly', q: string) {
    const params = new HttpParams().set('q', q).set('max_points', '800');
    return firstValueFrom(this.http.get<ISeriesPoint[]>(`${this.API}/forecast/${bucket}-series-by-query`, { params }));
  }

  // ---------------- Query aggregate forecast (optional overlay) -------------
  async runForecastForQuery() {
    this.errorMessage = null;
    const q = (this.queryCtrl.value || '').trim();
    if (!q) { this.errorMessage = 'This saved search has no query.'; return; }

    const period = this.periodSlug();
    const lag = this.lagCtrl.value ?? 3;
    const horizon = this.horizonCtrl.value ?? 12;
    const params = this.paramsValue();
    const features = this.featuresValue(period);
    const use_cleansed = this.useCleansedCtrl.value ?? false;

    this.loading = true;
    try {
      const body = { period, q, horizon, lag, use_cleansed, use_generated_periods: true, params, features, max_keys: 200 };
      const fcSeries = await firstValueFrom(
        this.http.post<ISeriesPoint[]>(`${this.API}/forecast/xgb/aggregate-by-query`, body)
      );
      if (!fcSeries?.length) { this.errorMessage = 'No forecast produced.'; return; }
      const labels = fcSeries.map(s => s.StartDate);
      const values = fcSeries.map(s => s.Qty);

      if (!this.chart) this.drawChart(labels, [], '');
      this.addDatasetAlignedStyled(labels, values, 'Forecast (Query)', {
        borderDash: [2,2],
        pointRadius: 2,
        borderColor: this.COLORS.forecastQuery,
        backgroundColor: this.COLORS.forecastQuery,
        pointBackgroundColor: this.COLORS.forecastQuery,
      });
    } catch (e) {
      console.error(e);
      this.errorMessage = 'Failed to run forecast for this query.';
    } finally {
      this.loading = false;
    }
  }
}
