import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    data: {
      title: 'Planning Run'
    },
    children: [
      {
        path: '',
        redirectTo: 'store-forecast',
        pathMatch: 'full'
      },
      {
        path: 'store-forecast',
        loadComponent: () => import('./store-forecast/store-forecast.component').then(m => m.StoreForecastComponent),
        data: {
          title: 'Store Forecast'
        }
      },
      {
        path: 'load-history',
        loadComponent: () => import('./load-history/load-history.component').then(m => m.LoadHistoryComponent),
        data: {
          title: 'Load History'
        }
      },
      {
      path: 'cleanse-history',
      loadComponent: () => import('./cleanse-history/cleanse-history.component').then(m => m.CleanseHistoryComponent),
      data: {
        title: 'Cleanse History'
      }
    }
    ]
  }
];
