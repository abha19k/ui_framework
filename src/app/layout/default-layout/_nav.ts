import { INavData } from '@coreui/angular';

export const navItems: INavData[] = [
  {
    name: 'Dashboard',
    url: '/dashboard',
    iconComponent: { name: 'cil-speedometer' },
    // badge: {
    //   color: 'info',
    //   text: 'NEW'
    // }
  }, 
  {
    name: 'Data',
    url: '/data',
    iconComponent: { name: 'cil-speedometer' },
    children: [
      {
        name: 'Channel',
        url: '/data/channel',
        icon: 'nav-icon-bullet'
      },
      {
        name: 'Demand Unit',
        url: '/data/demand-unit',
        icon: 'nav-icon-bullet'
      },
      {
        name: 'Forecast',
        url: '/data/forecast',
        icon: 'nav-icon-bullet'
      },
      {
        name: 'Global Parameters',
        url: '/data/global-parameters',
        icon: 'nav-icon-bullet'
      },
      {
        name: 'History',
        url: '/data/history',
        icon: 'nav-icon-bullet'
      },
      {
        name: 'Location',
        url: '/data/location',
        icon: 'nav-icon-bullet'
      },
      {
        name: 'Product',
        url: '/data/product',
        icon: 'nav-icon-bullet'
      }
    ]
  },
  {
    name: 'Process',
    url: '/process',
    iconComponent: { name: 'cil-speedometer' },
    children: [
      {
        name: 'Consensus Forecasting',
        url: '/process/consensus-forecasting',
        icon: 'nav-icon-bullet'
      },
      {
        name: 'Forecast Tuning',
        url: '/process/forecast-tuning',
        icon: 'nav-icon-bullet'
      }
    ]
  },
  {
    name: 'Planning Run',
    url: '/planning-run',
    iconComponent: { name: 'cil-speedometer' },
    // badge: {
    //   color: 'info',
    //   text: 'NEW'
    // }
  },    
];
