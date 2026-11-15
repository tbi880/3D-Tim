import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { ByteReader, ByteWriter, PacketError } from '../../src/game/net/codec/binary.js';

test('numbers come back as they were written', () => {
    const writer = new ByteWriter(4);
    writer.u8(200).i8(-100).u16(65000).i16(-30000).u32(4000000000).f32(1.5).f64(Math.PI);
    const reader = new ByteReader(writer.toArrayBuffer());

    assert.equal(reader.u8(), 200);
    assert.equal(reader.i8(), -100);
    assert.equal(reader.u16(), 65000);
    assert.equal(reader.i16(), -30000);
    assert.equal(reader.u32(), 4000000000);
    assert.equal(reader.f32(), 1.5);
    assert.equal(reader.f64(), Math.PI);
    reader.end();
});

test('the writer grows past its first size and can be reused', () => {
    const writer = new ByteWriter(2);
    for (let i = 0; i < 100; i++) writer.u32(i);
    assert.equal(writer.toArrayBuffer().byteLength, 400);
    assert.equal(new ByteReader(writer.toArrayBuffer()).u32(), 0);

    writer.reset().u8(7);
    assert.equal(writer.toArrayBuffer().byteLength, 1);
});

test('vectors, fractions and rotations survive within their precision', () => {
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 1.234);
    const writer = new ByteWriter();
    writer.vec3(new Vector3(-1200.5, 33.25, 9000)).unit16(0.3).unit16(-5).unit16(7).quat16(rotation);
    const reader = new ByteReader(writer.toArrayBuffer());

    assert.deepEqual(reader.vec3(new Vector3()).toArray(), [-1200.5, 33.25, 9000]);
    assert.ok(Math.abs(reader.unit16() - 0.3) < 1e-4);
    assert.equal(reader.unit16(), 0, 'fractions are clamped at 0');
    assert.equal(reader.unit16(), 1, 'fractions are clamped at 1');
    assert.ok(reader.quat16(new Quaternion()).angleTo(rotation) < 1e-3);
});

test('reading past the end is refused', () => {
    const reader = new ByteReader(new ArrayBuffer(3));
    reader.u16();
    assert.throws(() => reader.u16(), PacketError);
});

test('left-over bytes are refused', () => {
    const reader = new ByteReader(new ArrayBuffer(3));
    reader.u16();
    assert.throws(() => reader.end(), PacketError);
});

test('NaN and infinity are never accepted', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
        const buffer = new ByteWriter().f32(bad).f64(bad).toArrayBuffer();
        assert.throws(() => new ByteReader(buffer).f32(), PacketError);
        const reader = new ByteReader(buffer);
        reader.take(4);
        assert.throws(() => reader.f64(), PacketError);
    }
});

test('a rotation of all zeros is refused', () => {
    const buffer = new ByteWriter().i16(0).i16(0).i16(0).i16(0).toArrayBuffer();
    assert.throws(() => new ByteReader(buffer).quat16(new Quaternion()), PacketError);
});

test('typed array views are read from their own window', () => {
    const bytes = new Uint8Array([9, 9, 1, 2, 9]);
    const reader = new ByteReader(bytes.subarray(2, 4));
    assert.equal(reader.u8(), 1);
    assert.equal(reader.u8(), 2);
    reader.end();
});

test('anything that is not binary is refused', () => {
    assert.throws(() => new ByteReader('text'), PacketError);
    assert.throws(() => new ByteReader(null), PacketError);
});
