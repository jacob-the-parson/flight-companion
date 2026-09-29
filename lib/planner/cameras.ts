// Camera presets for ground-sample-distance maths.
//
// Every preset below is copied from the manufacturer's published specification
// (Raspberry Pi camera documentation, "Hardware specification" table, read
// 2026-09-29). Pixel counts are the sensor's still resolution. A camera that is not
// listed here is entered by hand under "Custom": this file does not guess.
// The Raspberry Pi AI Camera (IMX500) is deliberately absent; its specification
// table could not be read from a primary source when this was written.

export interface Camera {
  id: string;
  name: string;
  /** Sensor image area, millimetres. */
  sensorWidthMm: number;
  sensorHeightMm: number;
  focalLengthMm: number;
  imageWidthPx: number;
  imageHeightPx: number;
  source: string;
}

const PI_DOCS = 'raspberrypi.com/documentation/accessories/camera.html';

export const CAMERA_PRESETS: Camera[] = [
  {
    id: 'pi-cam3',
    name: 'Raspberry Pi Camera Module 3',
    sensorWidthMm: 6.45,
    sensorHeightMm: 3.63,
    focalLengthMm: 4.74,
    imageWidthPx: 4608,
    imageHeightPx: 2592,
    source: PI_DOCS,
  },
  {
    id: 'pi-cam3-wide',
    name: 'Raspberry Pi Camera Module 3 Wide',
    sensorWidthMm: 6.45,
    sensorHeightMm: 3.63,
    focalLengthMm: 2.75,
    imageWidthPx: 4608,
    imageHeightPx: 2592,
    source: PI_DOCS,
  },
  {
    id: 'pi-cam2',
    name: 'Raspberry Pi Camera Module 2',
    sensorWidthMm: 3.68,
    sensorHeightMm: 2.76,
    focalLengthMm: 3.04,
    imageWidthPx: 3280,
    imageHeightPx: 2464,
    source: PI_DOCS,
  },
  {
    id: 'pi-hq-6mm',
    name: 'Raspberry Pi HQ Camera, 6 mm lens',
    sensorWidthMm: 6.287,
    sensorHeightMm: 4.712,
    focalLengthMm: 6,
    imageWidthPx: 4056,
    imageHeightPx: 3040,
    source: `${PI_DOCS} (sensor); focal length is the lens fitted`,
  },
];

export const CUSTOM_CAMERA_ID = 'custom';

export const DEFAULT_CAMERA: Camera = { ...CAMERA_PRESETS[0] };
