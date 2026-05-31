import * as THREE from 'three';

// Day/night cycle — ported from the legacy updateDayNight, adapted for PBR + AgX. Drives the sun
// (position relative to the streaming focus so shadows stay where the player is), hemi fill, sky
// background, fog colour, and the IBL environmentIntensity, plus a warm sun-scattering fog tint.
// timeOfDay in [0,1): 0=midnight, .25=sunrise, .5=noon, .75=sunset.
const skyDay = new THREE.Color(0x9fd3ff);
const skyNight = new THREE.Color(0x0a1026);
const skyDusk = new THREE.Color(0xff8c5a);

export class DayNight {
  timeOfDay: number;
  dayLength: number;
  isNight = false;
  private a = new THREE.Color();
  private b = new THREE.Color();
  private sunDir = new THREE.Vector3();
  private camFwd = new THREE.Vector3();

  constructor(
    private sun: THREE.DirectionalLight,
    private hemi: THREE.HemisphereLight,
    private scene: THREE.Scene,
    opts: { timeOfDay?: number; dayLength?: number } = {},
  ) {
    this.timeOfDay = opts.timeOfDay ?? 0.32;
    this.dayLength = opts.dayLength ?? 140;
  }

  update(dt: number, focusX: number, focusZ: number, camera?: THREE.Camera): void {
    this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1;
    const ang = (this.timeOfDay - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const daylight = Math.max(0, elev);

    // sun follows the focus; high-noon overhead, low at dawn/dusk
    const hx = Math.cos(ang) * 140, hz = 70;
    this.sun.position.set(focusX + hx, Math.max(18, elev * 170), focusZ + hz);
    this.sun.target.position.set(focusX, 0, focusZ);
    this.sun.target.updateMatrixWorld();

    // intensities tuned for AgX tone mapping (higher than the old Lambert values)
    this.sun.intensity = 0.25 + daylight * 3.0;
    this.hemi.intensity = 0.25 + daylight * 0.8;
    this.scene.environmentIntensity = 0.12 + daylight * 0.6;
    this.isNight = daylight < 0.22;

    // sky colour: night → day, warm dusk wash near the horizon crossing
    const dusk = Math.max(0, 1 - Math.abs(elev) * 4);
    if (elev > 0) this.a.copy(skyNight).lerp(skyDay, Math.min(1, elev * 2));
    else this.a.copy(skyNight);
    this.a.lerp(skyDusk, dusk * 0.6);
    (this.scene.background as THREE.Color).copy(this.a);

    // fog = sky, with a warm scatter tint when looking toward the low sun
    this.b.copy(this.a);
    if (camera && elev > -0.15) {
      this.sunDir.set(hx, Math.max(0.05, elev) * 140, hz).normalize();
      camera.getWorldDirection(this.camFwd);
      const toward = Math.max(0, this.camFwd.dot(this.sunDir));
      const horizon = Math.max(0, 1 - Math.abs(elev) * 1.5);
      this.b.lerp(skyDusk, toward * toward * horizon * 0.5);
    }
    (this.scene.fog as THREE.Fog).color.copy(this.b);
  }
}
