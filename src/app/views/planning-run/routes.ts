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
        loadComponent: () => import('../data/history/history.component').then(m => m.HistoryComponent),
        data: {
          title: 'History'
        }
      },
      {
        path: 'channel',
        loadComponent: () => import('../data/channel/channel.component').then(m => m.ChannelComponent),
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
      }
    ]
  }
];
