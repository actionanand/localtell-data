import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Dashboard · LocalTell Web',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'easy',
    title: 'Easy Location · LocalTell Web',
    loadComponent: () => import('./features/easy-location/easy-location').then((m) => m.EasyLocation),
  },
  {
    path: 'map',
    title: 'Interactive Map · LocalTell Web',
    loadComponent: () => import('./features/interactive-map/interactive-map').then((m) => m.InteractiveMap),
  },
  {
    path: 'offline-data',
    title: 'Offline Data · LocalTell Web',
    loadComponent: () => import('./features/offline-data/offline-data').then((m) => m.OfflineData),
  },
  {
    path: 'saved',
    title: 'Saved Places · LocalTell Web',
    loadComponent: () => import('./features/saved-places/saved-places').then((m) => m.SavedPlaces),
  },
  {
    path: 'compare',
    title: 'Location Comparison · LocalTell Web',
    loadComponent: () => import('./features/location-comparison/location-comparison').then((m) => m.LocationComparison),
  },
  {
    path: 'backup',
    title: 'Dropbox Backup · LocalTell Web',
    loadComponent: () => import('./features/backup-sync/backup-sync').then((m) => m.BackupSync),
  },
  {
    path: 'dropbox/callback',
    title: 'Connecting Dropbox · LocalTell Web',
    loadComponent: () => import('./features/backup-sync/dropbox-callback').then((m) => m.DropboxCallback),
  },
  {
    path: 'settings',
    title: 'Settings · LocalTell Web',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: '' },
];
