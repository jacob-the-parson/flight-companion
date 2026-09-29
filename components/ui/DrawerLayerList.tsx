// DrawerLayerList — the SEMI-UNIVERSAL layers pattern (converged from the
// slicer/stitcher/flow right panels): rows of Eye/EyeOff · name · hover Trash2
// (disabled at minLayers), active row in accent tint, optional dashed add-row.
// Spec: DrawerLayerList.md
'use client';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';

import type { ReactNode } from 'react';

export interface LayerRowData {
  id: string;
  label: string;
  visible: boolean;
  /** Optional row glyph (scene-object type, layer kind badge, …). */
  icon?: ReactNode;
}

interface DrawerLayerListProps {
  layers: LayerRowData[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onRemove?: (id: string) => void;
  onAdd?: () => void;
  /** Deleting is disabled at this count (default 1 — never zero layers). */
  minLayers?: number;
  /** Active-row tint override (defaults to the secondary accent). */
  activeClass?: string;
}

export function DrawerLayerList({
  layers,
  activeId,
  onSelect,
  onToggleVisibility,
  onRemove,
  onAdd,
  minLayers = 1,
  activeClass = 'border-secondary bg-secondary-high/20 text-ink',
}: DrawerLayerListProps) {
  const removable = layers.length > minLayers;

  return (
    <div className="space-y-1">
      {layers.map((layer) => {
        const active = layer.id === activeId;
        return (
          <div
            key={layer.id}
            onClick={() => onSelect(layer.id)}
            className={`group flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs transition-colors ${
              active
                ? activeClass
                : 'border-edge bg-surface-raised/60 text-ink-muted hover:border-edge-strong/40 hover:text-ink'
            }`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility(layer.id);
              }}
              className="rounded p-1 text-ink-muted transition-colors hover:bg-surface-sunken"
              title={layer.visible ? 'Hide layer' : 'Show layer'}
            >
              {layer.visible ? <Eye size={13} /> : <EyeOff size={13} className="opacity-50" />}
            </button>
            {layer.icon && <span className={layer.visible ? '' : 'opacity-50'}>{layer.icon}</span>}
            <span className={`min-w-0 flex-1 truncate font-medium ${layer.visible ? '' : 'opacity-50'}`}>
              {layer.label}
            </span>
            {onRemove && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (removable) onRemove(layer.id);
                }}
                disabled={!removable}
                className={`rounded p-1 transition-colors ${
                  removable
                    ? 'text-ink-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30'
                    : 'cursor-not-allowed text-ink-muted opacity-30'
                }`}
                title={removable ? 'Delete layer' : `Keep at least ${minLayers}`}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      })}
      {onAdd && (
        <button
          onClick={onAdd}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-edge p-2 text-xs text-ink-muted transition-colors hover:border-edge-strong/50 hover:text-ink"
        >
          <Plus size={13} /> Add layer
        </button>
      )}
    </div>
  );
}
