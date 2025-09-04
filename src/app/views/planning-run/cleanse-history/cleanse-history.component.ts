import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import {
  ButtonDirective, CardBodyComponent, CardComponent, CardFooterComponent, CardHeaderComponent,
  ColComponent, RowComponent, TextColorDirective
} from '@coreui/angular';
import { IconDirective } from '@coreui/icons-angular';

type OutlierMethod = 'Z-Score' | 'IQR' | 'MAD' | 'Hampel';
type MissingMethod = 'Drop Rows' | 'Forward Fill' | 'Backward Fill' | 'Zero' | 'Mean' | 'Median' | 'Linear Interpolate';

interface CleanseProfile {
  id?: number;
  name: string;
  config: any;
  created_at?: string;
}

@Component({
  standalone: true,
  selector: 'app-cleanse-history',
  templateUrl: './cleanse-history.component.html',
  styleUrls: ['./cleanse-history.component.scss'],
  imports: [
    CommonModule, ReactiveFormsModule, HttpClientModule,
    TextColorDirective,
    CardComponent, CardHeaderComponent, CardBodyComponent, CardFooterComponent,
    RowComponent, ColComponent, ButtonDirective, IconDirective
  ]
})
export class CleanseHistoryComponent implements OnInit {
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);

  readonly API = 'http://127.0.0.1:8000/api';

  // ✅ these are referenced in the template
  profiles: CleanseProfile[] = [];
  errorMessage: string | null = null;
  loading = false;

  // ✅ full reactive form with nested groups
  form: FormGroup = this.fb.group({
    profileName: this.fb.control<string>('', { validators: [Validators.required], nonNullable: true }),

    outlierMethod: this.fb.control<OutlierMethod>('Z-Score', { nonNullable: true }),
    outlierParams: this.fb.group({
      zThreshold: this.fb.control<number>(3, { nonNullable: true }),
      iqrK: this.fb.control<number>(1.5, { nonNullable: true }),
      madK: this.fb.control<number>(3, { nonNullable: true }),
      hampelWindow: this.fb.control<number>(7, { nonNullable: true }),
      hampelK: this.fb.control<number>(3, { nonNullable: true }),
    }),

    missingMethod: this.fb.control<MissingMethod>('Forward Fill', { nonNullable: true }),
    missingParams: this.fb.group({
      interpolateOrder: this.fb.control<number>(1, { nonNullable: true }),
      fillConstant: this.fb.control<number>(0, { nonNullable: true }),
    }),
  });

  // ✅ used by *ngIf checks in the template
  get outlierMethod() {
    return this.form.get('outlierMethod')!.value as OutlierMethod;
  }

  ngOnInit(): void {
    this.refreshProfiles();
  }

  refreshProfiles() {
    this.http.get<CleanseProfile[]>(`${this.API}/cleanse/profiles`).subscribe({
      next: rows => (this.profiles = rows || []),
      error: e => console.error('Failed to load profiles', e)
    });
  }

  // ✅ called from template buttons to load a saved profile
  loadProfile(p: CleanseProfile) {
    if (!p) return;
    const { name, config } = p;
    this.form.patchValue({
      profileName: name || '',
      outlierMethod: config?.outlierMethod ?? 'Z-Score',
      outlierParams: {
        zThreshold: config?.outlierParams?.zThreshold ?? 3,
        iqrK: config?.outlierParams?.iqrK ?? 1.5,
        madK: config?.outlierParams?.madK ?? 3,
        hampelWindow: config?.outlierParams?.hampelWindow ?? 7,
        hampelK: config?.outlierParams?.hampelK ?? 3,
      },
      missingMethod: config?.missingMethod ?? 'Forward Fill',
      missingParams: {
        interpolateOrder: config?.missingParams?.interpolateOrder ?? 1,
        fillConstant: config?.missingParams?.fillConstant ?? 0,
      }
    });
  }

  saveProfile() {
    this.errorMessage = null;
    if (this.form.invalid) {
      this.errorMessage = 'Please enter a profile name.';
      this.form.markAllAsTouched();
      return;
    }
    const { profileName, ...config } = this.form.getRawValue();
    const body = { name: profileName, config };

    this.loading = true;
    this.http.post(`${this.API}/cleanse/profiles`, body).subscribe({
      next: () => {
        this.loading = false;
        this.refreshProfiles();
      },
      error: (e) => {
        this.loading = false;
        this.errorMessage = e?.error?.detail || 'Failed to save profile.';
      }
    });
  }
}
