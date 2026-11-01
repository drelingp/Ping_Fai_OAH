import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeRestraintProps, updateRestraintProps } from '../src/people.js';

test('bed restraints have four padded cuffs, four frame ties, waist belt and both raised rails', () => {
  const bed = { x: 4, z: 6, headDir: -1 };
  const props = makeRestraintProps(bed);
  assert.equal(props.children.filter((o) => o.name === 'wrist-cuff').length, 2);
  assert.equal(props.children.filter((o) => o.name === 'ankle-cuff').length, 2);
  assert.equal(props.children.filter((o) => o.name === 'frame-tie').length, 4);
  assert.equal(props.children.filter((o) => o.name === 'raised-rail').length, 4);
  assert.ok(props.getObjectByName('waist-belt'));
  const color = props.userData.markMaterial.color.clone();
  updateRestraintProps(props, 180);
  assert.notEqual(props.userData.markMaterial.color.getHex(), color.getHex());
  const scene = new THREE.Scene(); scene.add(props);
  props.removeFromParent();
  assert.equal(props.parent, null);
  assert.equal(props.userData.railsRaised, false);
});

test('restraint cuffs follow posed character bones in world space', () => {
  const person = new THREE.Group(), inner = new THREE.Group(), hand = new THREE.Bone();
  hand.name = 'hand_l'; hand.position.set(-0.3, 0.8, 0.2);
  inner.add(hand); person.add(inner); person.userData.anim = { inner };
  person.position.set(4, 0, 6);
  const props = makeRestraintProps({ x: 4, z: 6, headDir: 1 }, person);
  const cuff = props.getObjectByName('wrist-cuff');
  assert.ok(cuff.position.distanceTo(new THREE.Vector3(-0.3, 0.8, 0.2)) < 1e-9);
  hand.position.y = 0.9; updateRestraintProps(props, 60);
  assert.equal(cuff.position.y, 0.9);
});
