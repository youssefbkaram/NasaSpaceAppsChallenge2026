import type { RegionPreset } from '../types/fire';
import { ALL_COUNTRIES_REGION, LOCAL_COUNTRY_DATASETS } from './localCountryData';

export const REGION_PRESETS: RegionPreset[] = [
  ALL_COUNTRIES_REGION,
  ...LOCAL_COUNTRY_DATASETS.map(({ region }) => region),
  {
    id: 'amazon',
    name: 'Amazon Basin (Deforestation Arc)',
    description: 'Southern and eastern Amazon rainforest boundary in Brazil and Bolivia.',
    center: [-9.5, -55.0],
    zoom: 6,
    bounds: [[-14.5, -62.0], [-4.5, -48.0]],
    biome: 'Tropical Moist Forest & Cerrado Savanna',
    fireRegime: 'Anthropogenic clearing and dry-season fires'
  },
  {
    id: 'california',
    name: 'California Wildfire Corridor',
    description: 'Sierra Nevada foothills, coastal ranges, and chaparral zones.',
    center: [37.5, -120.0],
    zoom: 6,
    bounds: [[33.0, -124.5], [42.0, -115.5]],
    biome: 'Mediterranean Woodland, Chaparral & Coniferous Forests',
    fireRegime: 'Seasonal wildfires in Mediterranean climate'
  },
  {
    id: 'australia',
    name: 'Southeast Australia',
    description: 'Temperate eucalyptus forests of New South Wales and Victoria.',
    center: [-34.5, 149.0],
    zoom: 6,
    bounds: [[-39.0, 144.0], [-30.0, 154.0]],
    biome: 'Temperate Broadleaf & Sclerophyll Eucalyptus Forests',
    fireRegime: 'Seasonal forest fires'
  },
  {
    id: 'siberia',
    name: 'Siberian Boreal Taiga (Sakha)',
    description: 'Permafrost zone with larch forests and peatlands.',
    center: [62.0, 129.0],
    zoom: 5,
    bounds: [[57.0, 120.0], [67.0, 138.0]],
    biome: 'Boreal Taiga & Subarctic Peatland',
    fireRegime: 'Seasonal boreal forest fires'
  },
  {
    id: 'congo',
    name: 'Congo Basin Savanna Margin',
    description: 'Miombo and Guinean savanna-forest transition.',
    center: [-4.0, 21.0],
    zoom: 5,
    bounds: [[-10.0, 15.0], [2.0, 28.0]],
    biome: 'Tropical Humid Forest & Moist Savanna',
    fireRegime: 'Seasonal savanna fires'
  }
];
