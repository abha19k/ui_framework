import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    data: {
      title: 'Data'
    },
    children: [
      {
        path: '',
        redirectTo: 'history',
        pathMatch: 'full'
      },
      {
        path: 'forecast-tuning',
        loadComponent: () => import('./forecast-tuning/forecast-tuning.component').then(m => m.ForecastTuningComponent),
        data: {
          title: 'Forecast Tuning'
        }
      },
      {
        path: 'consensus-forecasting',
        loadComponent: () => import('./consensus-forecasting/consensus-forecasting.component').then(m => m.ConsensusForecastingComponent),
        data: {
          title: 'Consensus Forecasting'
        }
      }
    ]
  }
];
