// Planner right-drawer pages (zero-prop, store-connected):
//   PlannerSurveyPage  — height, overlap, direction, speed, per-type numbers
//   PlannerCameraPage  — preset or custom camera, and what one photo covers
//   PlannerResultsPage — the checks, then every derived number
//   PlannerExportPage  — write a plan file for the ground station
'use client';
import { useRouter } from 'next/navigation';
import { CircleCheck, Download, Info, OctagonAlert, TriangleAlert, Waypoints } from 'lucide-react';
import { DrawerField, DrawerSection, DrawerStat } from '@/components/ui/DrawerSection';
import { FieldNumber } from '@/components/ui/FieldNumber';
import { INPUT_CLASS } from '@/components/shell/ModalProfile';
import { CAMERA_PRESETS, CUSTOM_CAMERA_ID } from '@/lib/planner/cameras';
import { toQgcPlan, toWpl, type MissionInput } from '@/lib/planner/export';
import { ASSUMPTIONS, type CheckLevel, type PlanResult } from '@/lib/planner/survey';
import { downloadFile, fmtAltitude, fmtArea, fmtDistance, fmtDuration, fmtNum, fmtSpeed, slug } from '@/lib/units';
import { enduranceMinutes, useActiveAircraft } from '@/stores/core/aircraftStore';
import { useHandoffStore } from '@/stores/core/handoffStore';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { usePlannerStore, usePlanResult, useVertices } from '@/stores/domains/plannerStore';

const BTN =
  'flex w-full items-center justify-center gap-1.5 rounded-md border border-edge bg-control py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40';

function Percent({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint: string;
}) {
  return (
    <DrawerField label={`${label}: ${Math.round(value * 100)} %`}>
      <input
        type="range"
        min={0}
        max={90}
        step={5}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-full accent-sky-600"
      />
      <span className="block text-[11px] normal-case leading-snug tracking-normal text-ink-muted">{hint}</span>
    </DrawerField>
  );
}

export function PlannerSurveyPage() {
  const name = usePlannerStore((s) => s.name);
  const surveyType = usePlannerStore((s) => s.surveyType);
  const params = usePlannerStore((s) => s.params);
  const setName = usePlannerStore((s) => s.setName);
  const setParam = usePlannerStore((s) => s.setParam);
  const gridLike = surveyType === 'grid' || surveyType === 'crosshatch';

  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Plan" first>
        <DrawerField label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
        </DrawerField>
      </DrawerSection>

      <DrawerSection title="Flight">
        <FieldNumber
          label="Height above takeoff"
          unit="m"
          min={2}
          max={500}
          step={1}
          value={params.altitude}
          onChange={(v) => setParam('altitude', v)}
          hint="Higher covers more ground per photo and shows less detail."
        />
        <FieldNumber
          label="Speed on the lines"
          unit="m/s"
          min={0.5}
          max={25}
          step={0.5}
          value={params.speed}
          onChange={(v) => setParam('speed', v)}
        />
      </DrawerSection>

      {surveyType !== 'orbit' && (
        <DrawerSection title="Overlap">
          <Percent
            label="Front"
            value={params.frontOverlap}
            onChange={(v) => setParam('frontOverlap', v)}
            hint="One photo to the next along a line. 70 to 80 % is usual."
          />
          {surveyType !== 'perimeter' && (
            <Percent
              label="Side"
              value={params.sideOverlap}
              onChange={(v) => setParam('sideOverlap', v)}
              hint="One line to the next. 60 to 70 % is usual."
            />
          )}
          <DrawerField label="Camera mounted">
            <select
              value={params.orientation}
              onChange={(e) => setParam('orientation', e.target.value as 'landscape' | 'portrait')}
              className={INPUT_CLASS}
            >
              <option value="landscape">Long side across the line of flight</option>
              <option value="portrait">Long side along the line of flight</option>
            </select>
          </DrawerField>
        </DrawerSection>
      )}

      {gridLike && (
        <DrawerSection title="Grid">
          <FieldNumber
            label="Line direction"
            unit="° from north"
            min={0}
            max={359}
            step={5}
            value={params.angle}
            onChange={(v) => setParam('angle', v)}
            hint="0 runs the lines north to south, 90 east to west. Along the long side of the area means fewer turns."
          />
          <FieldNumber
            label="Overshoot at each end"
            unit="m"
            min={0}
            max={100}
            step={1}
            value={params.turnaround}
            onChange={(v) => setParam('turnaround', v)}
            hint="Flown past the edge so the aircraft is straight and steady before the first photo of the line."
          />
        </DrawerSection>
      )}

      {surveyType === 'corridor' && (
        <DrawerSection title="Corridor">
          <FieldNumber
            label="Width to cover"
            unit="m"
            min={1}
            max={2000}
            step={5}
            value={params.corridorWidth}
            onChange={(v) => setParam('corridorWidth', v)}
            hint="Total width, centred on the drawn line."
          />
        </DrawerSection>
      )}

      {surveyType === 'orbit' && (
        <DrawerSection title="Orbit">
          <FieldNumber
            label="Radius"
            unit="m"
            min={2}
            max={1000}
            step={1}
            value={params.orbitRadius}
            onChange={(v) => setParam('orbitRadius', v)}
          />
          <FieldNumber
            label="Points around the circle"
            min={4}
            max={120}
            step={1}
            value={params.orbitPoints}
            onChange={(v) => setParam('orbitPoints', Math.round(v))}
            hint="One photo position per point. 24 is one every 15 degrees."
          />
        </DrawerSection>
      )}
    </div>
  );
}

export function PlannerCameraPage() {
  const camera = usePlannerStore((s) => s.camera);
  const setCameraPreset = usePlannerStore((s) => s.setCameraPreset);
  const setCameraField = usePlannerStore((s) => s.setCameraField);
  const units = usePrefsStore((s) => s.units);
  const result = usePlanResult();
  const fp = result.footprint;

  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Camera" first>
        <DrawerField label="Preset">
          <select value={camera.id} onChange={(e) => setCameraPreset(e.target.value)} className={INPUT_CLASS}>
            {CAMERA_PRESETS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={CUSTOM_CAMERA_ID}>Custom camera</option>
          </select>
        </DrawerField>
        <p className="flex gap-1.5 text-[11px] leading-snug text-ink-muted">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>Figures from: {camera.source}. Changing any number below makes this a custom camera.</span>
        </p>
      </DrawerSection>

      <DrawerSection title="Sensor and lens">
        <div className="grid grid-cols-2 gap-3">
          <FieldNumber label="Sensor width" unit="mm" min={0.5} max={100} step={0.01} value={camera.sensorWidthMm} onChange={(v) => setCameraField('sensorWidthMm', v)} />
          <FieldNumber label="Sensor height" unit="mm" min={0.5} max={100} step={0.01} value={camera.sensorHeightMm} onChange={(v) => setCameraField('sensorHeightMm', v)} />
          <FieldNumber label="Image width" unit="px" min={100} max={20000} step={1} value={camera.imageWidthPx} onChange={(v) => setCameraField('imageWidthPx', Math.round(v))} />
          <FieldNumber label="Image height" unit="px" min={100} max={20000} step={1} value={camera.imageHeightPx} onChange={(v) => setCameraField('imageHeightPx', Math.round(v))} />
        </div>
        <FieldNumber
          label="Focal length"
          unit="mm"
          min={0.5}
          max={1000}
          step={0.01}
          value={camera.focalLengthMm}
          onChange={(v) => setCameraField('focalLengthMm', v)}
          hint="The real focal length of the lens, not the 35 mm equivalent."
        />
      </DrawerSection>

      <DrawerSection title="One photo covers">
        <DrawerStat label="Ground detail" value={`${fmtNum(fp.gsdCm, 2)} cm/px`} />
        <DrawerStat label="Across the line" value={fmtDistance(fp.across, units, 1)} />
        <DrawerStat label="Along the line" value={fmtDistance(fp.along, units, 1)} />
        <DrawerStat label="Line spacing" value={fmtDistance(fp.lineSpacing, units, 1)} />
        <DrawerStat label="Photo spacing" value={fmtDistance(fp.photoSpacing, units, 1)} />
        <DrawerStat
          label="Time between photos"
          value={Number.isFinite(fp.triggerInterval) ? `${fmtNum(fp.triggerInterval, 2)} s` : 'n/a'}
        />
      </DrawerSection>
    </div>
  );
}

const LEVEL: Record<CheckLevel, { icon: typeof CircleCheck; color: string; box: string; word: string }> = {
  good: {
    icon: CircleCheck,
    color: 'text-status-good',
    box: 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30',
    word: 'OK',
  },
  warning: {
    icon: TriangleAlert,
    color: 'text-status-warning',
    box: 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30',
    word: 'Check',
  },
  critical: {
    icon: OctagonAlert,
    color: 'text-status-critical',
    box: 'border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30',
    word: 'Stop',
  },
};

export function PlanChecks({ result }: { result: PlanResult }) {
  if (!result.ok) return <p className="text-xs italic text-ink-muted opacity-70">{result.reason}</p>;
  const order: CheckLevel[] = ['critical', 'warning', 'good'];
  const sorted = [...result.checks].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  return (
    <div className="space-y-2">
      {sorted.map((c) => {
        const L = LEVEL[c.level];
        return (
          <div key={c.title} className={`flex gap-2 rounded-lg border p-2.5 text-xs ${L.box}`}>
            <L.icon size={15} className={`mt-0.5 shrink-0 ${L.color}`} />
            <div className="min-w-0">
              <p className="font-semibold text-ink">
                <span className="mr-1.5 text-[9px] font-bold uppercase tracking-wider text-ink-muted">{L.word}</span>
                {c.title}
              </p>
              <p className="leading-snug text-ink-muted">{c.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PlannerResultsPage() {
  const result = usePlanResult();
  const params = usePlannerStore((s) => s.params);
  const units = usePrefsStore((s) => s.units);
  const aircraft = useActiveAircraft();

  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Checks" first>
        <PlanChecks result={result} />
      </DrawerSection>

      {result.ok && (
        <>
          <DrawerSection title="Coverage">
            <DrawerStat label="Area" value={fmtArea(result.areaM2, units)} />
            <DrawerStat label="Lines" value={result.lines} />
            <DrawerStat label="Photos, about" value={result.photos} />
            <DrawerStat label="Waypoints" value={result.waypoints.length} />
            <DrawerStat label="Ground detail" value={`${fmtNum(result.footprint.gsdCm, 2)} cm/px`} />
          </DrawerSection>

          <DrawerSection title="Flight">
            <DrawerStat label="Height" value={fmtAltitude(params.altitude, units, 0)} />
            <DrawerStat label="Speed" value={fmtSpeed(params.speed, units)} />
            <DrawerStat label="Survey pattern" value={fmtDistance(result.surveyLength, units)} />
            <DrawerStat label="To and from takeoff" value={fmtDistance(result.transitLength, units)} />
            <DrawerStat label="Total distance" value={fmtDistance(result.totalLength, units)} />
            <DrawerStat label="Farthest from takeoff" value={fmtDistance(result.maxDistanceFromHome, units)} />
            <DrawerStat label="Flight time" value={fmtDuration(result.flightTime)} />
            <DrawerStat label={`${aircraft.name} endurance`} value={`${fmtNum(enduranceMinutes(aircraft), 1)} min`} />
          </DrawerSection>

          <p className="text-[11px] leading-snug text-ink-muted">
            The time is an estimate in still air. It assumes {ASSUMPTIONS.climbMs} m/s climb,{' '}
            {ASSUMPTIONS.descentMs} m/s descent and {ASSUMPTIONS.secondsPerTurn} s for each turn. Endurance
            comes from the aircraft profile in the left drawer.
          </p>
        </>
      )}
    </div>
  );
}

/** Everything the export needs, or null when there is nothing to export yet. */
export function useMissionInput(): MissionInput | null {
  const surveyType = usePlannerStore((s) => s.surveyType);
  const vertices = useVertices();
  const home = usePlannerStore((s) => s.home);
  const params = usePlannerStore((s) => s.params);
  const aircraft = useActiveAircraft();
  const result = usePlanResult();
  if (!result.ok || !home) return null;
  return {
    type: surveyType,
    waypoints: result.waypoints,
    home,
    params,
    photoSpacing: result.footprint.photoSpacing,
    firmware: aircraft.firmware,
    ...(surveyType === 'orbit' && vertices[0] ? { roi: vertices[0] } : null),
  };
}

export function planFileName(name: string, ext: string): string {
  return `${new Date().toISOString().slice(0, 10)}-${slug(name)}.${ext}`;
}

export function PlannerExportPage() {
  const name = usePlannerStore((s) => s.name);
  const home = usePlannerStore((s) => s.home);
  const surveyType = usePlannerStore((s) => s.surveyType);
  const cameraTrigger = usePlannerStore((s) => s.params.cameraTrigger);
  const setParam = usePlannerStore((s) => s.setParam);
  const aircraft = useActiveAircraft();
  const result = usePlanResult();
  const mission = useMissionInput();
  const blocked = result.ok && result.checks.some((c) => c.level === 'critical');
  const send = useHandoffStore((s) => s.send);
  const router = useRouter();

  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Mission file" first>
        <DrawerStat label="For" value={aircraft.firmware === 'px4' ? 'PX4' : 'ArduPilot'} />
        <DrawerStat label="Ends with" value="Return" />
        {surveyType !== 'orbit' && (
          <label className="flex cursor-pointer items-start gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={cameraTrigger}
              onChange={(e) => setParam('cameraTrigger', e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-sky-600"
            />
            <span>
              Trigger the camera by distance
              <span className="block text-[11px] text-ink-muted">
                Adds a trigger command at the photo spacing. Only useful if the camera is wired to the
                autopilot&apos;s trigger output.
              </span>
            </span>
          </label>
        )}
      </DrawerSection>

      <DrawerSection title="Download">
        {!result.ok && <p className="text-xs italic text-ink-muted opacity-70">{result.reason}</p>}
        {result.ok && !home && (
          <p className="text-xs text-ink-muted">
            Set the takeoff point first. The mission starts with a takeoff there and ends with a return.
          </p>
        )}
        {blocked && (
          <div className="flex gap-2 rounded-lg border border-red-300 bg-red-50/70 p-2.5 text-xs dark:border-red-900 dark:bg-red-950/30">
            <OctagonAlert size={15} className="mt-0.5 shrink-0 text-status-critical" />
            <span className="text-ink">
              This plan has a check marked Stop. You can still download it. Read the Results page first.
            </span>
          </div>
        )}
        <button
          disabled={!mission}
          onClick={() => mission && downloadFile(planFileName(name, 'plan'), toQgcPlan(mission), 'application/json')}
          className={BTN}
        >
          <Download size={13} className="text-green-600 dark:text-green-500" /> QGroundControl plan (.plan)
        </button>
        <button
          disabled={!mission}
          onClick={() => mission && downloadFile(planFileName(name, 'waypoints'), toWpl(mission))}
          className={BTN}
        >
          <Download size={13} className="text-green-600 dark:text-green-500" /> Waypoint list (.waypoints)
        </button>
      </DrawerSection>

      <DrawerSection title="Other formats">
        <button
          disabled={!mission}
          onClick={() => {
            if (!mission) return;
            // the plan goes across as the file it would be on disk, and is read like one
            send({ to: 'missions', fileName: planFileName(name, 'plan'), text: toQgcPlan(mission), from: 'the Flight Planner' });
            router.push('/missions');
          }}
          className={BTN}
        >
          <Waypoints size={13} className="text-teal-600 dark:text-teal-400" /> Open in Missions
        </button>
        <p className="text-[11px] leading-snug text-ink-muted">
          Missions edits single waypoints and writes DJI, Garmin, KML and GPX files. The plan here stays as it is.
        </p>
      </DrawerSection>

      <DrawerSection title="Before you upload it">
        <ol className="list-decimal space-y-1.5 pl-4 text-[11px] leading-snug text-ink-muted">
          <li>Open the file in the ground station&apos;s Plan view. This app never talks to the aircraft.</li>
          <li>Look at every waypoint on the ground station&apos;s own map and check each height.</li>
          <li>Heights are above the takeoff point. The ground under the path may be higher than it.</li>
          <li>Upload from the ground station, with the aircraft on the ground and the props off.</li>
        </ol>
      </DrawerSection>
    </div>
  );
}
