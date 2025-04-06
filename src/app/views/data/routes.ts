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
        path: 'history',
        loadComponent: () => import('./history/history.component').then(m => m.HistoryComponent),
        data: {
          title: 'History'
        }
      },
      {
        path: 'channel',
        loadComponent: () => import('./channel/channel.component').then(m => m.ChannelComponent),
        data: {
          title: 'Channel'
        }
      },
      {
        path: 'demand-unit',
        loadComponent: () => import('../data/demand-unit/demand-unit.component').then(m => m.DemandUnitComponent),
        data: {
          title: 'Demand Unit'
        }
      },
      {
        path: 'product',
        loadComponent: () => import('../data/product/product.component').then(m => m.ProductComponent),
        data: {
          title: 'Product'
        }
      },
      {
        path: 'location',
        loadComponent: () => import('../data/location/location.component').then(m => m.LocationComponent),
        data: {
          title: 'Location'
        }
      }       
    ]
  }
];
