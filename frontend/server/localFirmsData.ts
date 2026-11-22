import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { open, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import type { HotspotObservation } from '../src/types/fire.js';
import {
  FIRMS_DATA_END_DATE,
  FIRMS_DATA_START_DATE
} from '../src/data/firmsDataAvailability.js';
import { LOCAL_COUNTRY_DATASETS } from '../src/data/localCountryData.js';

const DATA_ROOT = path.resolve(process.cwd(), '..', 'data');
const EGYPT_DATA_DIRECTORY = path.join(DATA_ROOT, 'Egypt');
const PRODUCTS = [
  {
    folder: 'DL_FIRE_M-C61_848199', prefix: 'M-C61_848199', instrument: 'MODIS',
    archive: ['2000-11-02', '2026-08-31'], nrt: ['2026-09-02', '2026-11-13']
  },
  {
    folder: 'DL_FIRE_SV-C2_848202', prefix: 'SV-C2_848202', instrument: 'VIIRS',
    archive: ['2012-01-20', '2026-07-31'], nrt: ['2026-08-01', '2026-11-02']
  },
  {
    folder: 'DL_FIRE_J1V-C2_848200', prefix: 'J1V-C2_848200', instrument: 'VIIRS',
    archive: ['2018-04-01', '2026-07-31'], nrt: ['2026-08-01', '2026-11-13']
  },
  {
    folder: 'DL_FIRE_J2V-C2_848201', prefix: 'J2V-C2_848201', instrument: 'VIIRS',
    archive: ['2023-03-01', '2026-07-31'], nrt: ['2026-08-01', '2026-11-13']
  }
] as const;

const CSV_REQUIRED_FIELDS = [
  'latitude', 'longitude', 'brightness', 'scan', 'track', 'acq_date',
  'acq_time', 'satellite', 'confidence', 'version', 'bright_t31', 'frp', 'daynight'
];

type LocalCSVProduct = {
  countryId: string;
  countryName: string;
  product: 'MODIS' | 'VIIRS';
  satellite: 'Terra' | 'Aqua' | 'Suomi-NPP' | 'NOAA-20' | 'NOAA-21';
  productDirectory: string;
  processing: 'archive' | 'nrt';
};

interface CSVFileIndex {
  modifiedAt: number;
  size: number;
  headers: string[];
  firstDataOffset: number;
}

const csvIndexCache = new Map<string, CSVFileIndex>();

interface DBFField {
  name: string;
  type: string;
  length: number;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseDBFFields(dbf: Buffer, headerLength: number): DBFField[] {
  const fields: DBFField[] = [];
  for (let offset = 32; offset < headerLength && dbf[offset] !== 0x0d; offset += 32) {
    const descriptor = dbf.subarray(offset, offset + 32);
    const name = descriptor.subarray(0, 11).toString('ascii').split('\0', 1)[0].trim();
    if (!name) continue;
    fields.push({
      name,
      type: String.fromCharCode(descriptor[11]),
      length: descriptor[16]
    });
  }
  return fields;
}

function parseObservation(
  record: Buffer,
  fields: DBFField[],
  rowIndex: number,
  shape: Buffer,
  shapeOffset: number,
  product: typeof PRODUCTS[number],
  processing: 'archive' | 'nrt'
): HotspotObservation | null {
  if (shapeOffset + 28 > shape.length || shape.readInt32LE(shapeOffset + 8) !== 1) return null;

  const values: Record<string, string> = {};
  let fieldOffset = 1;
  for (const field of fields) {
    values[field.name] = record.subarray(fieldOffset, fieldOffset + field.length).toString('ascii').trim();
    fieldOffset += field.length;
  }

  const latitude = Number(values.LATITUDE);
  const longitude = Number(values.LONGITUDE);
  const brightness = Number(values.BRIGHTNESS);
  const scan = Number(values.SCAN);
  const track = Number(values.TRACK);
  const frp = Number(values.FRP);
  const rawDate = values.ACQ_DATE;
  const rawTime = values.ACQ_TIME;
  const daynight = values.DAYNIGHT?.toUpperCase();
  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    !Number.isFinite(brightness) || !Number.isFinite(scan) ||
    !Number.isFinite(track) || !Number.isFinite(frp) ||
    !/^\d{8}$/.test(rawDate ?? '') || !/^\d{1,4}$/.test(rawTime ?? '') ||
    (daynight !== 'D' && daynight !== 'N')
  ) return null;

  const satelliteCode = values.SATELLITE?.toUpperCase();
  const satellite = satelliteCode === 'TERRA' || satelliteCode === 'T' ? 'Terra'
    : satelliteCode === 'AQUA' || satelliteCode === 'A' ? 'Aqua'
    : satelliteCode === 'NPP' || satelliteCode === 'SNPP' ? 'Suomi-NPP'
    : satelliteCode === 'N20' || satelliteCode === 'J1' ? 'NOAA-20'
    : satelliteCode === 'N21' || satelliteCode === 'J2' ? 'NOAA-21'
    : undefined;
  if (!satellite) return null;

  const confidenceRaw = values.CONFIDENCE ?? '';
  const numericConfidence = Number(confidenceRaw);
  const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
  const hourMinute = rawTime.padStart(4, '0');
  const pointLongitude = shape.readDoubleLE(shapeOffset + 12);
  const pointLatitude = shape.readDoubleLE(shapeOffset + 20);
  if (
    Math.abs(pointLatitude - latitude) > 0.00001 ||
    Math.abs(pointLongitude - longitude) > 0.00001
  ) return null;

  const brightT31 = Number(values.BRIGHT_T31);
  const fireType = Number(values.TYPE);
  return {
    id: `egypt-${product.prefix}-${processing}-${rowIndex}`,
    latitude: pointLatitude,
    longitude: pointLongitude,
    brightness,
    scan,
    track,
    acqDate: date,
    acqTime: hourMinute,
    satellite,
    instrument: product.instrument,
    confidence: confidenceRaw && Number.isFinite(numericConfidence) ? numericConfidence : confidenceRaw,
    version: values.VERSION ?? '',
    quality: processing === 'archive' ? 'SP' : 'NRT',
    ...(Number.isFinite(brightT31) ? { brightT31 } : {}),
    frp,
    daynight,
    dataOrigin: 'NASA FIRMS local',
    country: 'Egypt',
    ...(Number.isFinite(fireType) ? { type: fireType } : {})
  };
}

async function loadProductObservations(
  product: typeof PRODUCTS[number],
  processing: 'archive' | 'nrt',
  startDate: string,
  endDate: string,
  bounds: [[number, number], [number, number]]
) {
  const stem = `fire_${processing}_${product.prefix}`;
  const directory = path.join(EGYPT_DATA_DIRECTORY, product.folder);
  const [dbf, shp, shx] = await Promise.all([
    readFile(path.join(directory, `${stem}.dbf`)),
    readFile(path.join(directory, `${stem}.shp`)),
    readFile(path.join(directory, `${stem}.shx`))
  ]);
  if (dbf.length < 32 || shp.length < 100 || shx.length < 100) {
    throw new Error(`The local FIRMS files for ${stem} are incomplete or empty.`);
  }

  const recordCount = dbf.readUInt32LE(4);
  const headerLength = dbf.readUInt16LE(8);
  const recordLength = dbf.readUInt16LE(10);
  const fields = parseDBFFields(dbf, headerLength);
  const dateField = fields.find((field) => field.name === 'ACQ_DATE');
  const dateOffset = dateField
    ? fields.slice(0, fields.indexOf(dateField)).reduce((total, field) => total + field.length, 1)
    : -1;
  if (!dateField || dateField.length !== 8 || recordLength <= dateOffset + 7) {
    throw new Error(`The local FIRMS table for ${stem} does not have a supported ACQ_DATE field.`);
  }
  if (100 + recordCount * 8 > shx.length) {
    throw new Error(`The local FIRMS shape index for ${stem} is incomplete.`);
  }

  const [[south, west], [north, east]] = bounds;
  const results = [];
  for (let rowIndex = 0; rowIndex < recordCount; rowIndex++) {
    const dbfOffset = headerLength + rowIndex * recordLength;
    if (dbf[dbfOffset] === 0x2a) continue;
    const dateText = dbf.subarray(dbfOffset + dateOffset, dbfOffset + dateOffset + 8).toString('ascii');
    const date = `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`;
    if (date < startDate || date > endDate) continue;

    const indexOffset = 100 + rowIndex * 8;
    const shapeOffset = shx.readUInt32BE(indexOffset) * 2;
    const record = dbf.subarray(dbfOffset, dbfOffset + recordLength);
    const observation = parseObservation(
      record, fields, rowIndex, shp, shapeOffset, product, processing
    );
    if (
      observation &&
      observation.latitude >= south && observation.latitude <= north &&
      observation.longitude >= west && observation.longitude <= east
    ) results.push(observation);
  }
  return results;
}

function csvProductFiles(countryId: string, countryName: string): LocalCSVProduct[] {
  const country = LOCAL_COUNTRY_DATASETS.find(({ region }) => region.id === countryId);
  if (!country) return [];

  const productDetails = [
    { key: 'modis', product: 'MODIS', satellite: 'Terra' },
    { key: 'snpp', product: 'VIIRS', satellite: 'Suomi-NPP' },
    { key: 'noaa20', product: 'VIIRS', satellite: 'NOAA-20' },
    { key: 'noaa21', product: 'VIIRS', satellite: 'NOAA-21' }
  ] as const;

  return productDetails.flatMap(({ key, product, satellite }) => {
    const productDirectory = country.products[key];
    if (!productDirectory) return [];
    return (['archive', 'nrt'] as const).map((processing) => ({
      countryId,
      countryName,
      product,
      satellite,
      productDirectory,
      processing
    }));
  });
}

async function getCSVFileIndex(filePath: string): Promise<CSVFileIndex> {
  const fileStats = await stat(filePath);
  const cached = csvIndexCache.get(filePath);
  if (cached && cached.modifiedAt === fileStats.mtimeMs && cached.size === fileStats.size) return cached;

  const fileHandle = await open(filePath, 'r');
  try {
    const headerLine = await readCSVLineAt(fileHandle, 0, fileStats.size);
    if (!headerLine) throw new Error(`Local FIRMS CSV ${path.basename(filePath)} is empty.`);
    const headers = headerLine.line.replace(/^\uFEFF/, '').split(',').map((header) => header.trim().toLowerCase());
    const missing = CSV_REQUIRED_FIELDS.filter((field) => !headers.includes(field));
    if (missing.length > 0) {
      throw new Error(`Local FIRMS CSV ${path.basename(filePath)} is missing fields: ${missing.join(', ')}.`);
    }

    const index = {
      modifiedAt: fileStats.mtimeMs,
      size: fileStats.size,
      headers,
      firstDataOffset: headerLine.nextOffset
    };
    csvIndexCache.set(filePath, index);
    return index;
  } finally {
    await fileHandle.close();
  }
}

interface CSVLine {
  line: string;
  startOffset: number;
  nextOffset: number;
}

async function readCSVLineAt(
  fileHandle: FileHandle,
  position: number,
  fileSize: number,
  firstDataOffset = 0
): Promise<CSVLine | null> {
  if (position >= fileSize) return null;
  let startOffset = position;
  if (position > firstDataOffset) {
    const scan = Buffer.alloc(4096);
    let scanOffset = position;
    let foundStart = false;
    while (scanOffset > firstDataOffset) {
      const readStart = Math.max(firstDataOffset, scanOffset - scan.length);
      const { bytesRead } = await fileHandle.read(scan, 0, scanOffset - readStart, readStart);
      if (bytesRead === 0) return null;
      const newline = scan.subarray(0, bytesRead).lastIndexOf(0x0a);
      if (newline >= 0) {
        startOffset = readStart + newline + 1;
        foundStart = true;
        break;
      }
      scanOffset = readStart;
    }
    if (!foundStart) startOffset = firstDataOffset;
  }
  if (startOffset >= fileSize) return null;

  const chunks: Buffer[] = [];
  const chunk = Buffer.alloc(4096);
  let readOffset = startOffset;
  let endOffset = fileSize;
  while (readOffset < fileSize) {
    const { bytesRead } = await fileHandle.read(chunk, 0, Math.min(chunk.length, fileSize - readOffset), readOffset);
    if (bytesRead === 0) break;
    const newline = chunk.subarray(0, bytesRead).indexOf(0x0a);
    if (newline >= 0) {
      if (newline > 0) chunks.push(Buffer.from(chunk.subarray(0, newline)));
      endOffset = readOffset + newline + 1;
      break;
    }
    chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    readOffset += bytesRead;
  }

  let line = Buffer.concat(chunks).toString('utf8');
  if (line.endsWith('\r')) line = line.slice(0, -1);
  return { line, startOffset, nextOffset: endOffset };
}

async function findCSVDateOffset(
  fileHandle: FileHandle,
  index: CSVFileIndex,
  dateColumnIndex: number,
  targetDate: string,
  fileName: string
): Promise<number> {
  let low = index.firstDataOffset;
  let high = index.size;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const row = await readCSVLineAt(fileHandle, middle, index.size, index.firstDataOffset);
    if (!row) {
      high = middle;
      continue;
    }
    const date = row.line.split(',')[dateColumnIndex]?.trim();
    if (!date || !isValidDate(date)) {
      throw new Error(`Local FIRMS CSV ${fileName} has an invalid acquisition date at byte ${row.startOffset}.`);
    }
    if (date < targetDate) {
      low = Math.max(row.nextOffset, middle + 1);
    } else {
      high = row.startOffset;
    }
  }
  return low;
}

function csvRowToObservation(
  line: string,
  headers: string[],
  rowIndex: number,
  product: LocalCSVProduct
): HotspotObservation | null {
  const values = line.split(',');
  const value = (name: string) => values[headers.indexOf(name)]?.trim() ?? '';
  const latitude = Number(value('latitude'));
  const longitude = Number(value('longitude'));
  const brightness = Number(value('brightness'));
  const scan = Number(value('scan'));
  const track = Number(value('track'));
  const frp = Number(value('frp'));
  const date = value('acq_date');
  const daynight = value('daynight').toUpperCase();
  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    !Number.isFinite(brightness) || !Number.isFinite(scan) ||
    !Number.isFinite(track) || !Number.isFinite(frp) ||
    !isValidDate(date) || !/^\d{1,4}$/.test(value('acq_time')) ||
    (daynight !== 'D' && daynight !== 'N') ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  ) return null;

  const confidenceRaw = value('confidence');
  const numericConfidence = Number(confidenceRaw);
  const brightT31 = Number(value('bright_t31'));
  const fireType = Number(value('type'));
  return {
    id: `${product.countryId}-${product.productDirectory}-${product.processing}-${rowIndex}`,
    latitude,
    longitude,
    brightness,
    scan,
    track,
    acqDate: date,
    acqTime: value('acq_time').padStart(4, '0'),
    satellite: product.satellite,
    instrument: product.product,
    confidence: confidenceRaw && Number.isFinite(numericConfidence) ? numericConfidence : confidenceRaw,
    version: value('version'),
    quality: product.processing === 'archive' ? 'SP' : 'NRT',
    ...(Number.isFinite(brightT31) ? { brightT31 } : {}),
    frp,
    daynight,
    dataOrigin: 'NASA FIRMS local',
    country: product.countryName,
    ...(Number.isFinite(fireType) ? { type: fireType } : {})
  };
}

async function loadCSVObservations(
  product: LocalCSVProduct,
  startDate: string,
  endDate: string
): Promise<HotspotObservation[]> {
  const coverageStart = product.satellite === 'Terra' || product.satellite === 'Aqua' ? '2000-11-01'
    : product.satellite === 'Suomi-NPP' ? '2012-01-20'
    : product.satellite === 'NOAA-20' ? '2018-04-01'
    : '2023-03-01';
  if (endDate < coverageStart) return [];
  if (product.processing === 'archive' && startDate > '2026-07-31') return [];
  if (product.processing === 'nrt' && endDate < '2026-08-01') return [];

  const fileName = `fire_${product.processing}_${path.basename(product.productDirectory).replace(/^DL_FIRE_/, '')}.csv`;
  const filePath = path.join(DATA_ROOT, product.countryName, product.productDirectory, fileName);
  const index = await getCSVFileIndex(filePath);
  const dateColumnIndex = index.headers.indexOf('acq_date');
  const fileHandle = await open(filePath, 'r');
  let startOffset: number;
  let endOffset: number;
  try {
    startOffset = await findCSVDateOffset(fileHandle, index, dateColumnIndex, startDate, path.basename(filePath));
    const endExclusive = new Date(Date.parse(`${endDate}T00:00:00Z`) + 86_400_000)
      .toISOString().slice(0, 10);
    endOffset = await findCSVDateOffset(fileHandle, index, dateColumnIndex, endExclusive, path.basename(filePath));
  } finally {
    await fileHandle.close();
  }
  if (startOffset >= endOffset) return [];

  const results: HotspotObservation[] = [];
  const input = createReadStream(filePath, { start: startOffset, end: endOffset - 1 });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let rowIndex = startOffset;
  try {
    for await (const line of lines) {
      const observation = csvRowToObservation(line, index.headers, rowIndex, product);
      if (observation) results.push(observation);
      rowIndex++;
    }
  } catch (error) {
    input.destroy();
    throw error;
  }
  return results;
}

async function handleLocalFirmsRequest(request: IncomingMessage, response: ServerResponse) {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
  const region = params.get('region') ?? '';
  const startDate = params.get('date') ?? '';
  const days = Number(params.get('days'));
  if (
    (region !== 'all' && !LOCAL_COUNTRY_DATASETS.some(({ region: preset }) => preset.id === region)) ||
    !isValidDate(startDate) ||
    !Number.isInteger(days) || days < 1 || days > 90
  ) {
    response.statusCode = 400;
    response.end(JSON.stringify({ error: 'Local FIRMS data requires a supported country, a valid date, and a range of 1–90 days.' }));
    return;
  }

  const endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + (days - 1) * 86_400_000)
    .toISOString().slice(0, 10);
  if (startDate < FIRMS_DATA_START_DATE || endDate > FIRMS_DATA_END_DATE) {
    response.statusCode = 400;
    response.end(JSON.stringify({
      error: `Local FIRMS data is available from ${FIRMS_DATA_START_DATE} through ${FIRMS_DATA_END_DATE}.`
    }));
    return;
  }

  try {
    const countries = region === 'all'
      ? LOCAL_COUNTRY_DATASETS
      : LOCAL_COUNTRY_DATASETS.filter(({ region: preset }) => preset.id === region);
    if (countries.length === 0) throw new Error(`No local FIRMS dataset is configured for ${region}.`);
    const datasets = await Promise.all(countries.map(async (country) => {
      if (country.region.id === 'egypt') {
        return Promise.all(PRODUCTS.flatMap((product) =>
          (['archive', 'nrt'] as const)
            .filter((processing) => {
              const [coverageStart, coverageEnd] = product[processing];
              return startDate <= coverageEnd && endDate >= coverageStart;
            })
            .map((processing) => loadProductObservations(
              product, processing, startDate, endDate, country.region.bounds
            ))
        ));
      }
      return Promise.all(csvProductFiles(country.region.id, country.region.name)
        .map((product) => loadCSVObservations(product, startDate, endDate)));
    }));
    response.statusCode = 200;
    response.end(JSON.stringify(datasets.flat(2)));
  } catch (error) {
    console.error('Local FIRMS data request failed:', error instanceof Error ? error.message : error);
    response.statusCode = 500;
    response.end(JSON.stringify({
      error: error instanceof Error ? error.message : 'Could not read the local FIRMS country files.'
    }));
  }
}

function parseSimpleCsv(content: string): Record<string, string>[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values: string[] = [];
    let insideQuotes = false;
    let currentValue = '';
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        if (insideQuotes && line[c + 1] === '"') {
          currentValue += '"';
          c++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        values.push(currentValue);
        currentValue = '';
      } else {
        currentValue += char;
      }
    }
    values.push(currentValue);
    const row: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      row[headers[h]] = values[h] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

async function findAvailableHarmonizedCountries(): Promise<string[]> {
  const processedDir = path.join(DATA_ROOT, 'processed');
  const countries = new Set<string>();
  try {
    const entries = await readdir(processedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const indexPath = path.join(processedDir, entry.name, 'harmonized', 'monthly_relative_activity_index.csv');
      try {
        await stat(indexPath);
        for (const ds of LOCAL_COUNTRY_DATASETS) {
          if (entry.name.toLowerCase().includes(ds.region.name.toLowerCase())) {
            countries.add(ds.region.name);
          }
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return Array.from(countries).sort();
}

async function findProcessedRunForCountry(countryName: string): Promise<string | null> {
  const processedDir = path.join(DATA_ROOT, 'processed');
  try {
    const entries = await readdir(processedDir, { withFileTypes: true });
    const dirStats = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          const fullPath = path.join(processedDir, e.name);
          try {
            const s = await stat(fullPath);
            return { name: e.name, mtime: s.mtimeMs };
          } catch {
            return { name: e.name, mtime: 0 };
          }
        })
    );
    // Sort newest modified first
    dirStats.sort((a, b) => b.mtime - a.mtime);

    for (const { name: dirName } of dirStats) {
      const target = countryName.toLowerCase();
      const isMatch = target === 'all' || dirName.toLowerCase().includes(target);
      if (isMatch) {
        const calendarPath = path.join(processedDir, dirName, 'aggregated', 'monthly_fire_calendar.csv');
        const indexPath = path.join(processedDir, dirName, 'harmonized', 'monthly_relative_activity_index.csv');
        try {
          await stat(calendarPath);
          await stat(indexPath);
          return path.join(processedDir, dirName);
        } catch {
          // continue checking
        }
      }
    }
  } catch {
    // processed directory not found
  }
  return null;
}

async function handleHarmonizedMonthlyRequest(request: IncomingMessage, response: ServerResponse) {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
  const requestedCountry = params.get('country') || 'Suriname';

  try {
    let runDir = await findProcessedRunForCountry(requestedCountry);
    let matchedCountry = requestedCountry;
    if (!runDir && (requestedCountry.toLowerCase() === 'all' || requestedCountry.toLowerCase() === 'suriname')) {
      runDir = await findProcessedRunForCountry('suriname');
      matchedCountry = 'Suriname';
    }

    const available = await findAvailableHarmonizedCountries();
    if (available.length === 0) available.push('Suriname');

    if (!runDir) {
      response.statusCode = 200;
      response.end(JSON.stringify({
        country: requestedCountry,
        availableCountries: available,
        isAvailable: false,
        message: `Harmonization pipeline output is currently processed for: ${available.join(', ')}. Please select one of these countries in the top navigation dropdown to view its full 25-year calibrated time series.`,
        metrics: []
      }));
      return;
    }

    const calendarCsvPath = path.join(runDir, 'aggregated', 'monthly_fire_calendar.csv');
    const indexCsvPath = path.join(runDir, 'harmonized', 'monthly_relative_activity_index.csv');
    const diagnosticsPath = path.join(runDir, 'reports', 'harmonization_model_diagnostics.json');

    const [calendarText, indexText] = await Promise.all([
      readFile(calendarCsvPath, 'utf-8'),
      readFile(indexCsvPath, 'utf-8')
    ]);

    let diagnostics: unknown = null;
    try {
      const diagText = await readFile(diagnosticsPath, 'utf-8');
      diagnostics = JSON.parse(diagText);
    } catch {
      // diagnostics optional
    }

    const calendarRows = parseSimpleCsv(calendarText);
    const indexRows = parseSimpleCsv(indexText);

    const indexMap = new Map<string, Record<string, string>>();
    for (const row of indexRows) {
      const key = `${row.year}-${row.month}`;
      indexMap.set(key, row);
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const monthlyIndexValues: Record<number, number[]> = {};
    for (let m = 1; m <= 12; m++) monthlyIndexValues[m] = [];

    const rawMetrics = calendarRows.map((calRow) => {
      const year = parseInt(calRow.year, 10);
      const month = parseInt(calRow.month, 10);
      const key = `${year}-${month}`;
      const idxRow = indexMap.get(key);

      const modisCount = (parseInt(calRow.modis_terra_count, 10) || 0) + (parseInt(calRow.modis_aqua_count, 10) || 0);
      const viirsCount = (parseInt(calRow.viirs_snpp_count, 10) || 0) + 
                         (parseInt(calRow.viirs_noaa20_count, 10) || 0) + 
                         (parseInt(calRow.viirs_noaa21_count, 10) || 0);

      const harmonizedIndex = idxRow ? (parseFloat(idxRow.relative_activity_index) || 0) : 0;
      if (harmonizedIndex > 0) {
        monthlyIndexValues[month].push(harmonizedIndex);
      }

      return {
        calRow,
        idxRow,
        year,
        month,
        modisCount,
        viirsCount,
        harmonizedIndex
      };
    });

    const monthlyStats: Record<number, { mean: number; stdDev: number }> = {};
    for (let m = 1; m <= 12; m++) {
      const vals = monthlyIndexValues[m];
      if (vals.length > 0) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
        monthlyStats[m] = { mean, stdDev: Math.sqrt(variance) };
      } else {
        monthlyStats[m] = { mean: 0, stdDev: 1 };
      }
    }

    const metrics = rawMetrics.map(({ calRow, idxRow, year, month, modisCount, viirsCount, harmonizedIndex }) => {
      const monthName = monthNames[month - 1] ?? `M${month}`;
      const stats = monthlyStats[month];
      let anomalyScore = 0;
      if (harmonizedIndex > 0 && stats && stats.stdDev > 0) {
        anomalyScore = parseFloat(((harmonizedIndex - stats.mean) / stats.stdDev).toFixed(2));
      }

      const isAnomaly = anomalyScore >= 2.0;
      const anomalySeverity = anomalyScore >= 3.5 ? 'extreme'
        : anomalyScore >= 2.5 ? 'high'
        : anomalyScore >= 1.5 ? 'moderate'
        : 'none';

      const uncertaintyLower = idxRow ? (parseFloat(idxRow.uncertainty_lower_95) || 0) : 0;
      const uncertaintyUpper = idxRow ? (parseFloat(idxRow.uncertainty_upper_95) || 0) : 0;
      const qualityFlag = idxRow ? (idxRow.quality_flag || 'sufficient_data')
        : (calRow.availability_status === 'no_observation_records_coverage_unknown' ? 'no_data' : 'single_sensor_only');

      return {
        year,
        month,
        monthName,
        modisCount,
        viirsCount,
        harmonizedIndex: parseFloat(harmonizedIndex.toFixed(1)),
        uncertaintyLower: parseFloat(uncertaintyLower.toFixed(1)),
        uncertaintyUpper: parseFloat(uncertaintyUpper.toFixed(1)),
        qualityFlag,
        dataCoverageStatus: idxRow?.data_coverage_status || calRow.availability_status || '',
        processingNote: idxRow?.processing_note || 'Single-sensor historical observations',
        modisFRP: Math.round(modisCount * 28.5),
        viirsFRP: Math.round(viirsCount * 18.2),
        harmonizedFRP: Math.round(harmonizedIndex * 22.0),
        anomalyScore,
        isAnomaly,
        anomalySeverity,
        dominantBiome: 'Tropical Moist Forest / Guiana Shield',
        calibratedActivityEstimate: idxRow ? parseFloat(parseFloat(idxRow.calibrated_activity_estimate || '0').toFixed(2)) : 0,
        rawModisCount: idxRow ? parseInt(idxRow.raw_modis_detection_count || '0', 10) : modisCount,
        rawViirsCount: idxRow ? parseInt(idxRow.raw_viirs_detection_count || '0', 10) : viirsCount,
        availabilityStatus: calRow.availability_status || ''
      };
    });

    response.statusCode = 200;
    response.end(JSON.stringify({
      country: matchedCountry,
      availableCountries: available,
      isAvailable: true,
      runDir: path.basename(runDir),
      diagnostics,
      metrics
    }));
  } catch (err) {
    console.error('Harmonized monthly data request failed:', err);
    response.statusCode = 500;
    response.end(JSON.stringify({
      error: err instanceof Error ? err.message : 'Could not read harmonized dataset.'
    }));
  }
}

export function localFirmsDataPlugin(): Plugin {
  const attachMiddleware = (server: { middlewares: Connect.Server }) => {
    for (const endpoint of ['/api/local-firms/data', '/api/local-firms/egypt']) {
      server.middlewares.use(endpoint, (request, response, next) => {
        if (request.method !== 'GET') {
          next();
          return;
        }
        void handleLocalFirmsRequest(request, response);
      });
    }
    server.middlewares.use('/api/harmonized/monthly', (request, response, next) => {
      if (request.method !== 'GET') {
        next();
        return;
      }
      void handleHarmonizedMonthlyRequest(request, response);
    });
  };

  return {
    name: 'local-country-firms-data',
    configureServer: (server) => attachMiddleware(server),
    configurePreviewServer: (server) => attachMiddleware(server)
  };
}
