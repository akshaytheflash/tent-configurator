/**
 * 2D flat-lay editor.
 *
 * Renders the printable parts (roof peaks, valance, walls) as clip paths and
 * the artwork layers inside them. Scaling/dragging is stored back in
 * part-local millimetres, never screen pixels - so the document is independent
 * of zoom, device pixel ratio and viewport size, and the 3D texture and print
 * export consume the same numbers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import type { ImageLayer, Layout, PartConfig, ProductDefinition, TextLayer } from '@tent/core';
import { pointInPolygon } from '@tent/core';
import { imageFor } from '../rendering/assets';
import { useConfigurator } from '../store';

interface Props {
  product: ProductDefinition;
  config: ReturnType<typeof useConfigurator.getState>['config'];
  layout: Layout;
}

const PART_FILL_ALPHA = 0.92;

export function Canvas2D({ layout }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [fit, setFit] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [userZoom, setUserZoom] = useState(1);
  const [tick, setTick] = useState(0);

  const config = useConfigurator((s) => s.config);
  const focusPartId = useConfigurator((s) => s.focusPartId);
  const selectedLayerId = useConfigurator((s) => s.selectedLayerId);
  const setFocusPart = useConfigurator((s) => s.setFocusPart);
  const selectLayer = useConfigurator((s) => s.selectLayer);

  // Track container size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit-to-view scale: mm -> px.
  useEffect(() => {
    const pad = 48;
    const scale = Math.min(
      (size.width - pad * 2) / layout.widthMm,
      (size.height - pad * 2) / layout.heightMm,
    );
    setFit(scale);
    setOffset({
      x: (size.width - layout.widthMm * scale) / 2,
      y: (size.height - layout.heightMm * scale) / 2,
    });
  }, [size, layout]);

  const scale = fit * userZoom;
  const toPx = (v: number) => v * scale;

  // Repaint when remote images finish decoding.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1200);
    return () => window.clearInterval(id);
  }, []);

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);

  const selectedNodeId = selectedLayerId ? `layer-${selectedLayerId}` : null;
  useEffect(() => {
    const stage = stageRef.current;
    const tr = trRef.current;
    if (!stage || !tr) return;
    if (!selectedNodeId) {
      tr.nodes([]);
      return;
    }
    const node = stage.findOne(`#${selectedNodeId}`);
    if (node) {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    }
  }, [selectedNodeId, config, tick, scale]);

  const orderedParts = useMemo(() => Object.values(config.parts), [config]);

  return (
    <div ref={containerRef} className="canvas2d" onWheel={(e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setUserZoom((z) => Math.min(4, Math.max(0.4, z * (e.deltaY < 0 ? 1.08 : 0.92))));
    }}>
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onClick={(e) => {
          const stage = stageRef.current;
          if (!stage || e.target === stage) {
            selectLayer(focusPartId, null);
            return;
          }
          const node = e.target as unknown as Konva.Node;
          const partId = node.getAttr('data-part') as string | undefined;
          if (partId && !node.getAttr('data-layer')) {
            setFocusPart(partId);
            selectLayer(partId, null);
          }
        }}
      >
        <Layer>
          <Rect
            x={offset.x}
            y={offset.y}
            width={toPx(layout.widthMm)}
            height={toPx(layout.heightMm)}
            cornerRadius={10}
            fill="#ffffff"
            shadowColor="#00000018"
            shadowBlur={24}
            shadowOffsetY={6}
          />
          {layout.seams.map((s, i) => (
            <Line
              key={`seam-${i}`}
              points={[offset.x + toPx(s.x1), offset.y + toPx(s.y1), offset.x + toPx(s.x2), offset.y + toPx(s.y2)]}
              stroke="#c9ccd1"
              strokeWidth={1}
              dash={[6, 6]}
              listening={false}
            />
          ))}
        </Layer>

        <Layer>
          {orderedParts.map((part) => (
            <PartGroup
              key={part.partId}
              part={part}
              layout={layout}
              offset={offset}
              scale={scale}
              focused={focusPartId === part.partId}
              selectedLayerId={selectedLayerId}
              tick={tick}
              onSelectPart={() => setFocusPart(part.partId)}
              onSelectLayer={(id) => selectLayer(part.partId, id)}
            />
          ))}
        </Layer>

        <Layer>
          <Transformer
            ref={trRef}
            rotateEnabled
            rotateAnchorOffset={24}
            borderStroke="#111111"
            borderDash={[4, 3]}
            anchorStroke="#111111"
            anchorFill="#ffffff"
            anchorSize={9}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 12 || newBox.height < 12 ? oldBox : newBox)}
          />
        </Layer>
      </Stage>
    </div>
  );
}

function PartGroup({
  part, layout, offset, scale, focused, selectedLayerId, tick, onSelectPart, onSelectLayer,
}: {
  part: PartConfig;
  layout: Layout;
  offset: { x: number; y: number };
  scale: number;
  focused: boolean;
  selectedLayerId: string | null;
  tick: number;
  onSelectPart: () => void;
  onSelectLayer: (id: string | null) => void;
}) {
  const box = layout.partBoxes[part.partId];
  const pieces = layout.pieces.filter((p) => p.partId === part.partId);
  const updateLayer = useConfigurator((s) => s.updateLayer);
  if (!box || !pieces.length) return null;

  const originX = offset.x + box.x * scale;
  const originY = offset.y + box.y * scale;

  const outline = pieces.find((p) => p.piece === 'outer') ?? pieces[0];
  return (
    <Group>
      {/* Printable area: the base colour drawn through the exact polygon. */}
      {pieces.map((piece) => {
        const pts = piece.points.flatMap((p) => [offset.x + p.x * scale, offset.y + p.y * scale]);
        return (
          <Line
            key={piece.piece}
            points={pts}
            closed
            fill={part.color.hex}
            opacity={PART_FILL_ALPHA}
            stroke={focused ? '#111111' : '#9aa0a6'}
            strokeWidth={focused ? 1.6 : 0.8}
            data-part={part.partId}
            onClick={onSelectPart}
            hitStrokeWidth={0}
          />
        );
      })}

      {/* Artwork, clipped to the outer piece. */}
      <Group
        clipFunc={(ctx) => {
          if (typeof ctx.beginPath !== 'function') return;
          ctx.beginPath();
          outline.points.forEach((p, i) => {
            const x = offset.x + p.x * scale;
            const y = offset.y + p.y * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        }}
      >
        {part.layers.map((layer) => {
          if (!layer.visible) return null;
          if (layer.type === 'image') {
            return (
              <ImageLayerNode
                key={layer.id}
                layer={layer}
                origin={{ x: originX, y: originY }}
                scale={scale}
                tick={tick}
                selected={selectedLayerId === layer.id}
                onSelect={() => onSelectLayer(layer.id)}
                onChange={(patch) => updateLayer(part.partId, layer.id, patch)}
              />
            );
          }
          return (
            <TextLayerNode
              key={layer.id}
              layer={layer}
              origin={{ x: originX, y: originY }}
              scale={scale}
              selected={selectedLayerId === layer.id}
              onSelect={() => onSelectLayer(layer.id)}
              onChange={(patch) => updateLayer(part.partId, layer.id, patch)}
            />
          );
        })}
      </Group>
    </Group>
  );
}

function useAsset(tick: number, layer: ImageLayer) {
  const key = layer.asset?.id ?? layer.src;
  const [img, setImg] = useState<HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined>(imageFor(key, layer.src));

  useEffect(() => {
    const found = imageFor(key, layer.src);
    if (found) {
      setImg(found);
      return;
    }
    // Decode via an <img> for Konva compatibility.
    const im = new window.Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => setImg(im);
    im.src = layer.src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  return img;
}

function ImageLayerNode({
  layer, origin, scale, tick, selected, onSelect, onChange,
}: {
  layer: ImageLayer;
  origin: { x: number; y: number };
  scale: number;
  tick: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<ImageLayer>) => void;
}) {
  const img = useAsset(tick, layer);
  const ref = useRef<Konva.Image>(null);
  const w = layer.width * scale;
  const h = layer.height * scale;

  return (
    <KonvaImage
      ref={ref}
      id={`layer-${layer.id}`}
      data-layer={layer.id}
      image={img as CanvasImageSource}
      x={origin.x + layer.x * scale}
      y={origin.y + layer.y * scale}
      width={w}
      height={h}
      rotation={layer.rotation}
      opacity={layer.opacity}
      draggable
      onMouseDown={onSelect}
      onTap={onSelect}
      stroke={selected ? '#111111' : undefined}
      onDragEnd={(e) => {
        const node = e.target;
        onChange({
          x: (node.x() - origin.x) / scale,
          y: (node.y() - origin.y) / scale,
        });
      }}
      onTransformEnd={() => {
        const node = ref.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: (node.x() - origin.x) / scale,
          y: (node.y() - origin.y) / scale,
          width: Math.max(10, (node.width() * scaleX) / scale),
          height: Math.max(10, (node.height() * scaleY) / scale),
          rotation: node.rotation(),
        });
      }}
    />
  );
}

function TextLayerNode({
  layer, origin, scale, selected, onSelect, onChange,
}: {
  layer: TextLayer;
  origin: { x: number; y: number };
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<TextLayer>) => void;
}) {
  const ref = useRef<Konva.Text>(null);
  return (
    <Text
      ref={ref}
      id={`layer-${layer.id}`}
      data-layer={layer.id}
      text={layer.text}
      x={origin.x + layer.x * scale}
      y={origin.y + layer.y * scale}
      fontSize={layer.fontSize * scale}
      fontFamily={layer.fontFamily}
      fontStyle="bold"
      fill={layer.fill}
      align={layer.align}
      letterSpacing={(layer.letterSpacing ?? 0) * scale}
      rotation={layer.rotation}
      opacity={layer.opacity}
      lineHeight={1.15}
      draggable
      onMouseDown={onSelect}
      onTap={onSelect}
      stroke={selected ? '#111111' : undefined}
      strokeWidth={selected ? 0.5 : 0}
      onDragEnd={(e) => {
        onChange({
          x: (e.target.x() - origin.x) / scale,
          y: (e.target.y() - origin.y) / scale,
        });
      }}
      onTransformEnd={() => {
        const node = ref.current;
        if (!node) return;
        const sx = node.scaleX();
        const sy = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: (node.x() - origin.x) / scale,
          y: (node.y() - origin.y) / scale,
          fontSize: Math.max(8, (node.fontSize() * (sx + sy)) / 2 / scale),
          rotation: node.rotation(),
        });
      }}
    />
  );
}

/** Hit test used by the storefront to validate layer placement (exported for tests). */
export function layerIsInsidePart(layer: ImageLayer, piecePoints: Array<{ x: number; y: number }>) {
  return pointInPolygon({ x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 }, piecePoints);
}
