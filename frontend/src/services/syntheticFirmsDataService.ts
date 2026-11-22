import type { HotspotObservation, RegionPreset } from '../types/fire';

const DAY_MS = 24 * 60 * 60 * 1000;

function createRandomGenerator(seedText: string): () => number {
  let seed = 2166136261;
  for (const character of seedText) {
    seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  }

  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function availableSatellites(date: string): Array<HotspotObservation['satellite']> {
  const satellites: Array<HotspotObservation['satellite']> = ['Terra'];
  if (date >= '2002-07-04') satellites.push('Aqua');
  if (date >= '2012-01-01') satellites.push('Suomi-NPP');
  if (date >= '2018-04-01') satellites.push('NOAA-20');
  if (date >= '2024-01-01') satellites.push('NOAA-21');
  return satellites;
}

export function createSyntheticFIRMSObservations(
  startDate: string,
  region: RegionPreset,
  dayCount = 1
): HotspotObservation[] {
  const random = createRandomGenerator(`${region.id}|${startDate}|${dayCount}`);
  const [[south, west], [north, east]] = region.bounds;
  const daysThroughToday = Math.floor(
    (Date.now() - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS
  ) + 1;
  const availableDays = Math.min(dayCount, daysThroughToday);
  if (availableDays < 1) return [];

  const count = 80 + Math.floor(random() * 81);
  const observations: HotspotObservation[] = [];

  for (let index = 0; index < count; index++) {
    const observationDate = formatDate(
      new Date(Date.parse(`${startDate}T00:00:00Z`) + Math.floor(random() * availableDays) * DAY_MS)
    );
    const satellites = availableSatellites(observationDate);
    const useViirs = observationDate >= '2012-01-01' && random() < 0.58;
    const instrument = useViirs ? 'VIIRS' : 'MODIS';
    const satellite = useViirs
      ? satellites.filter((candidate) => candidate !== 'Terra' && candidate !== 'Aqua')[
          Math.floor(random() * (satellites.length - 1))
        ]
      : satellites[Math.floor(random() * Math.min(satellites.length, 2))];
    const isScienceQuality = Date.now() - Date.parse(`${observationDate}T00:00:00Z`) >= 150 * DAY_MS;
    const latitude = south + random() * (north - south);
    const longitude = west + random() * (east - west);
    const acquisitionHour = Math.floor(random() * 24);
    const acquisitionMinute = Math.floor(random() * 60);
    const confidence = instrument === 'VIIRS'
      ? ['n', 'l', 'n', 'h'][Math.floor(random() * 4)]
      : 30 + Math.floor(random() * 71);

    observations.push({
      id: `synthetic-${region.id}-${startDate}-${index}`,
      latitude: Number(latitude.toFixed(5)),
      longitude: Number(longitude.toFixed(5)),
      brightness: Number((instrument === 'MODIS'
        ? 310 + random() * 75
        : 290 + random() * 90).toFixed(2)),
      scan: Number((instrument === 'MODIS'
        ? 0.5 + random() * 1.5
        : 0.35 + random() * 0.4).toFixed(2)),
      track: Number((instrument === 'MODIS'
        ? 0.5 + random() * 1.5
        : 0.35 + random() * 0.4).toFixed(2)),
      acqDate: observationDate,
      acqTime: `${String(acquisitionHour).padStart(2, '0')}${String(acquisitionMinute).padStart(2, '0')}`,
      satellite,
      instrument,
      confidence,
      version: instrument === 'MODIS' ? '6.1' : isScienceQuality ? '2.0SP' : '2.0NRT',
      quality: isScienceQuality ? 'SP' : 'NRT',
      brightT31: Number((285 + random() * 35).toFixed(2)),
      frp: Number((2 + random() * 180).toFixed(2)),
      daynight: random() < 0.55 ? 'D' : 'N',
      dataOrigin: 'synthetic'
    });
  }

  return observations;
}
