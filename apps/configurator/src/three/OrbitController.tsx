/**
 * Minimal orbit controller.
 *
 * drei's OrbitControls fights any other code that moves the camera (camera
 * presets, exports), because it keeps its own internal target and spherical
 * state. This controller owns the camera only while enabled and reads/writes
 * spherical coordinates directly, so preset changes and free orbiting cannot
 * disagree.
 */
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

const TARGET = new THREE.Vector3(0, 2.0, 0);

export function OrbitController({ enabled }: { enabled: boolean }) {
  const { camera, gl, invalidate } = useThree();
  const spherical = useRef(new THREE.Spherical(8.4, THREE.MathUtils.degToRad(70), THREE.MathUtils.degToRad(45)));

  // Sync from the camera whenever we become enabled (after a preset change).
  useEffect(() => {
    if (!enabled) return;
    const offset = new THREE.Vector3().subVectors(camera.position, TARGET);
    spherical.current.setFromVector3(offset);
    spherical.current.phi = THREE.MathUtils.clamp(spherical.current.phi, 0.12, Math.PI / 2.04);
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  function apply() {
    const s = spherical.current;
    s.radius = THREE.MathUtils.clamp(s.radius, 4, 18);
    const offset = new THREE.Vector3().setFromSpherical(s);
    camera.position.copy(TARGET).add(offset);
    camera.lookAt(TARGET);
    camera.updateProjectionMatrix();
    invalidate();
  }

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;
    let dragging: 'rotate' | 'pan' | null = null;
    let lastX = 0;
    let lastY = 0;

    const down = (e: PointerEvent) => {
      dragging = e.button === 2 || e.shiftKey ? 'pan' : 'rotate';
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (dragging === 'rotate') {
        spherical.current.theta -= dx * 0.006;
        spherical.current.phi = THREE.MathUtils.clamp(
          spherical.current.phi - dy * 0.006,
          0.12,
          Math.PI / 2.04,
        );
      } else {
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        const scale = spherical.current.radius * 0.0016;
        TARGET.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
      }
      apply();
    };
    const up = (e: PointerEvent) => {
      dragging = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      spherical.current.radius *= 1 + Math.sign(e.deltaY) * 0.08;
      apply();
    };
    const ctx = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', ctx);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', ctx);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, gl, camera]);

  return null;
}
