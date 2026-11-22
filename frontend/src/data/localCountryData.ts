import type { RegionPreset } from '../types/fire.js';

export const ALL_COUNTRIES_REGION: RegionPreset = {
  id: 'all',
  name: 'All countries',
  description: 'Combined FIRMS observations from all countries with local datasets.',
  center: [-2.0, -20.0],
  zoom: 2,
  bounds: [[-35.0, -93.0], [39.0, 40.0]],
  biome: 'Multiple biomes',
  fireRegime: 'Combined satellite-detected thermal anomalies and active fires'
};

export interface LocalCountryDataset {
  region: RegionPreset;
  products: {
    modis?: string;
    snpp?: string;
    noaa20?: string;
    noaa21?: string;
  };
}

export const LOCAL_COUNTRY_DATASETS: LocalCountryDataset[] = [
  {
    region: {
      id: 'egypt',
      name: 'Egypt',
      description: 'Egypt FIRMS active-fire observations from the local MODIS and VIIRS archive downloads.',
      center: [26.8, 29.8],
      zoom: 5,
      bounds: [[22.0, 24.7], [31.7, 36.9]],
      biome: 'Nile Valley, Mediterranean coast, and Sahara',
      fireRegime: 'Satellite-detected thermal anomalies and active fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_848199',
      snpp: 'DL_FIRE_SV-C2_848202',
      noaa20: 'DL_FIRE_J1V-C2_848200',
      noaa21: 'DL_FIRE_J2V-C2_848201'
    }
  },
  {
    region: {
      id: 'algeria',
      name: 'Algeria',
      description: 'FIRMS active-fire observations from the supplied Algeria country downloads.',
      center: [28.0, 2.5],
      zoom: 4,
      bounds: [[18.5, -9.0], [38.0, 12.0]],
      biome: 'Sahara, Mediterranean coast, and Atlas Mountains',
      fireRegime: 'Satellite-detected thermal anomalies and active fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_848840',
      snpp: 'DL_FIRE_SV-C2_848843',
      noaa20: 'DL_FIRE_J1V-C2_848841',
      noaa21: 'DL_FIRE_J2V-C2_848842'
    }
  },
  {
    region: {
      id: 'libya',
      name: 'Libya',
      description: 'FIRMS active-fire observations from the supplied Libya country downloads.',
      center: [27.0, 17.0],
      zoom: 5,
      bounds: [[19.0, 8.5], [34.0, 26.0]],
      biome: 'Sahara and Mediterranean coastal steppe',
      fireRegime: 'Satellite-detected thermal anomalies and active fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_848844',
      snpp: 'DL_FIRE_SV-C2_848847',
      noaa20: 'DL_FIRE_J1V-C2_848845',
      noaa21: 'DL_FIRE_J2V-C2_848846'
    }
  },
  {
    region: {
      id: 'mauritania',
      name: 'Mauritania',
      description: 'FIRMS active-fire observations from the supplied Mauritania country downloads.',
      center: [20.3, -10.5],
      zoom: 5,
      bounds: [[14.7, -17.1], [27.3, -4.8]],
      biome: 'Sahara, Sahel, and Atlantic coast',
      fireRegime: 'Seasonal Sahelian fires and satellite-detected thermal anomalies'
    },
    products: {
      modis: 'DL_FIRE_M-C61_849140',
      snpp: 'DL_FIRE_SV-C2_849143',
      noaa20: 'DL_FIRE_J1V-C2_849141',
      noaa21: 'DL_FIRE_J2V-C2_849142'
    }
  },
  {
    region: {
      id: 'morocco',
      name: 'Morocco',
      description: 'FIRMS country-download observations; the supplied extent also includes Western Sahara.',
      center: [31.8, -7.0],
      zoom: 5,
      bounds: [[20.0, -18.0], [37.0, -1.0]],
      biome: 'Mediterranean, Atlas Mountain, and Saharan ecosystems',
      fireRegime: 'Satellite-detected thermal anomalies and active fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_848849',
      snpp: 'DL_FIRE_SV-C2_848852',
      noaa20: 'DL_FIRE_J1V-C2_848850',
      noaa21: 'DL_FIRE_J2V-C2_848851'
    }
  },
  {
    region: {
      id: 'sudan',
      name: 'Sudan',
      description: 'FIRMS active-fire observations from the supplied Sudan country downloads.',
      center: [15.5, 30.0],
      zoom: 5,
      bounds: [[8.0, 21.0], [23.0, 39.0]],
      biome: 'Sahel, savanna, and desert ecosystems',
      fireRegime: 'Seasonal savanna fires and satellite-detected thermal anomalies'
    },
    products: {
      modis: 'DL_FIRE_M-C61_848863',
      snpp: 'DL_FIRE_SV-C2_848866',
      noaa20: 'DL_FIRE_J1V-C2_848864',
      noaa21: 'DL_FIRE_J2V-C2_848865'
    }
  },
  {
    region: {
      id: 'tunisia',
      name: 'Tunisia',
      description: 'FIRMS active-fire observations from the supplied Tunisia country downloads.',
      center: [34.0, 9.5],
      zoom: 6,
      bounds: [[29.5, 7.0], [38.0, 12.0]],
      biome: 'Mediterranean coast, Atlas foothills, and Sahara',
      fireRegime: 'Satellite-detected thermal anomalies and active fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_848858',
      snpp: 'DL_FIRE_SV-C2_848861',
      noaa20: 'DL_FIRE_J1V-C2_848859',
      noaa21: 'DL_FIRE_J2V-C2_848860'
    }
  },
  {
    region: {
      id: 'bolivia',
      name: 'Bolivia',
      description: 'FIRMS active-fire observations from the supplied Bolivia country downloads.',
      center: [-16.7, -64.7],
      zoom: 5,
      bounds: [[-23.5, -70.0], [-9.0, -57.0]],
      biome: 'Amazon rainforest, Chiquitano dry forest, and Gran Chaco',
      fireRegime: 'Seasonal forest, savanna, and agricultural fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_849055',
      snpp: 'DL_FIRE_SV-C2_849058',
      noaa20: 'DL_FIRE_J1V-C2_849056',
      noaa21: 'DL_FIRE_J2V-C2_849057'
    }
  },
  {
    region: {
      id: 'brazil',
      name: 'Brazil',
      description: 'FIRMS active-fire observations from the supplied Brazil country downloads.',
      center: [-10.0, -52.0],
      zoom: 4,
      bounds: [[-35.0, -74.0], [6.0, -32.0]],
      biome: 'Amazon, Cerrado, Pantanal, and Atlantic Forest',
      fireRegime: 'Seasonal tropical forest, savanna, and agricultural fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_849047',
      noaa20: 'DL_FIRE_J1V-C2_849048',
      noaa21: 'DL_FIRE_J2V-C2_849049'
    }
  },
  {
    region: {
      id: 'colombia',
      name: 'Colombia',
      description: 'FIRMS active-fire observations from the supplied Colombia country downloads.',
      center: [4.5, -73.5],
      zoom: 5,
      bounds: [[-5.0, -82.0], [14.5, -66.0]],
      biome: 'Amazon rainforest, Andes, Llanos, and Caribbean lowlands',
      fireRegime: 'Seasonal savanna and agricultural fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_849051',
      snpp: 'DL_FIRE_SV-C2_849054',
      noaa20: 'DL_FIRE_J1V-C2_849052',
      noaa21: 'DL_FIRE_J2V-C2_849053'
    }
  },
  {
    region: {
      id: 'ecuador',
      name: 'Ecuador',
      description: 'FIRMS active-fire observations from the supplied Ecuador country downloads.',
      center: [-1.5, -78.3],
      zoom: 6,
      bounds: [[-6.0, -92.0], [2.0, -74.0]],
      biome: 'Andes, Amazon rainforest, and Pacific coast',
      fireRegime: 'Seasonal forest and agricultural fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_849132',
      snpp: 'DL_FIRE_SV-C2_849135',
      noaa20: 'DL_FIRE_J1V-C2_849133',
      noaa21: 'DL_FIRE_J2V-C2_849134'
    }
  },
  {
    region: {
      id: 'guyana',
      name: 'Guyana',
      description: 'FIRMS active-fire observations from the supplied Guyana country downloads.',
      center: [5.0, -58.9],
      zoom: 6,
      bounds: [[0.5, -62.5], [9.0, -55.0]],
      biome: 'Guiana Shield rainforest, wetlands, and savanna',
      fireRegime: 'Seasonal savanna and land-management fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_849136',
      snpp: 'DL_FIRE_SV-C2_849139',
      noaa20: 'DL_FIRE_J1V-C2_849137',
      noaa21: 'DL_FIRE_J2V-C2_849138'
    }
  },
  {
    region: {
      id: 'paraguay',
      name: 'Paraguay',
      description: 'FIRMS active-fire observations from the supplied Paraguay country downloads.',
      center: [-23.4, -58.4],
      zoom: 6,
      bounds: [[-28.0, -63.0], [-19.0, -54.0]],
      biome: 'Gran Chaco, Pantanal, and Atlantic Forest',
      fireRegime: 'Seasonal forest, savanna, and agricultural fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_849153',
      snpp: 'DL_FIRE_SV-C2_849156',
      noaa20: 'DL_FIRE_J1V-C2_849154',
      noaa21: 'DL_FIRE_J2V-C2_849155'
    }
  },
  {
    region: {
      id: 'peru',
      name: 'Peru',
      description: 'FIRMS active-fire observations from the supplied Peru country downloads.',
      center: [-9.2, -75.0],
      zoom: 5,
      bounds: [[-18.5, -81.5], [0.1, -68.5]],
      biome: 'Andes, Amazon rainforest, and Pacific coast',
      fireRegime: 'Seasonal forest and agricultural fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_849063',
      snpp: 'DL_FIRE_SV-C2_849066',
      noaa20: 'DL_FIRE_J1V-C2_849064',
      noaa21: 'DL_FIRE_J2V-C2_849065'
    }
  },
  {
    region: {
      id: 'suriname',
      name: 'Suriname',
      description: 'FIRMS active-fire observations from the supplied Suriname country downloads.',
      center: [4.0, -56.0],
      zoom: 7,
      bounds: [[1.8, -58.1], [6.1, -53.9]],
      biome: 'Guiana Shield rainforest, wetlands, and savanna',
      fireRegime: 'Seasonal savanna and land-management fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_849148',
      snpp: 'DL_FIRE_SV-C2_849151',
      noaa20: 'DL_FIRE_J1V-C2_849149',
      noaa21: 'DL_FIRE_J2V-C2_849150'
    }
  },
  {
    region: {
      id: 'venezuela',
      name: 'Venezuela',
      description: 'FIRMS active-fire observations from the supplied Venezuela country downloads.',
      center: [7.0, -66.0],
      zoom: 5,
      bounds: [[0.5, -73.5], [12.5, -59.5]],
      biome: 'Amazon rainforest, Llanos, and Caribbean coast',
      fireRegime: 'Seasonal savanna and forest fires'
    },
    products: {
      modis: 'DL_FIRE_M-C61_849059',
      snpp: 'DL_FIRE_SV-C2_849062',
      noaa20: 'DL_FIRE_J1V-C2_849060',
      noaa21: 'DL_FIRE_J2V-C2_849061'
    }
  }
];
