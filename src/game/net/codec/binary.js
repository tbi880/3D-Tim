/**
 * Byte-level reading and writing for the packets sent many times a second (snapshots and
 * inputs). Everything is little-endian. The reader never trusts its input: reading past the
 * end throws a PacketError, which the caller treats as "drop this packet".
 */

export class PacketError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PacketError';
    }
}

/** Writes into a buffer that grows as needed; `reset()` lets one writer be reused for every packet. */
export class ByteWriter {
    constructor(initialSize = 1024) {
        this.buffer = new ArrayBuffer(initialSize);
        this.view = new DataView(this.buffer);
        this.offset = 0;
    }

    reset() {
        this.offset = 0;
        return this;
    }

    ensure(extra) {
        const needed = this.offset + extra;
        if (needed <= this.buffer.byteLength) return;
        const grown = new ArrayBuffer(Math.max(needed, this.buffer.byteLength * 2));
        new Uint8Array(grown).set(new Uint8Array(this.buffer, 0, this.offset));
        this.buffer = grown;
        this.view = new DataView(grown);
    }

    u8(value) { this.ensure(1); this.view.setUint8(this.offset, value); this.offset += 1; return this; }
    i8(value) { this.ensure(1); this.view.setInt8(this.offset, value); this.offset += 1; return this; }
    u16(value) { this.ensure(2); this.view.setUint16(this.offset, value, true); this.offset += 2; return this; }
    i16(value) { this.ensure(2); this.view.setInt16(this.offset, value, true); this.offset += 2; return this; }
    u32(value) { this.ensure(4); this.view.setUint32(this.offset, value, true); this.offset += 4; return this; }
    f32(value) { this.ensure(4); this.view.setFloat32(this.offset, value, true); this.offset += 4; return this; }
    f64(value) { this.ensure(8); this.view.setFloat64(this.offset, value, true); this.offset += 8; return this; }

    /** A Vector3 as three 32-bit floats. */
    vec3(vector) { return this.f32(vector.x).f32(vector.y).f32(vector.z); }

    /** A 0..1 fraction as 16 bits. */
    unit16(fraction) { return this.u16(Math.round(clamp01(fraction) * 65535)); }

    /** A unit quaternion as four signed 16-bit numbers (about 0.002 degrees of precision). */
    quat16(quaternion) {
        return this.i16(toSnorm16(quaternion.x)).i16(toSnorm16(quaternion.y)).i16(toSnorm16(quaternion.z)).i16(toSnorm16(quaternion.w));
    }

    /** A copy of what has been written so far. */
    toArrayBuffer() {
        return this.buffer.slice(0, this.offset);
    }
}

export class ByteReader {
    /** @param {ArrayBuffer | ArrayBufferView} data */
    constructor(data) {
        if (ArrayBuffer.isView(data)) this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        else if (data instanceof ArrayBuffer) this.view = new DataView(data);
        else throw new PacketError('not binary data');
        this.offset = 0;
    }

    get remaining() {
        return this.view.byteLength - this.offset;
    }

    take(size) {
        if (this.offset + size > this.view.byteLength) throw new PacketError('packet is too short');
        const at = this.offset;
        this.offset += size;
        return at;
    }

    u8() { return this.view.getUint8(this.take(1)); }
    i8() { return this.view.getInt8(this.take(1)); }
    u16() { return this.view.getUint16(this.take(2), true); }
    i16() { return this.view.getInt16(this.take(2), true); }
    u32() { return this.view.getUint32(this.take(4), true); }
    f64() { return finite(this.view.getFloat64(this.take(8), true)); }
    /** A float that is a real number: NaN and infinities are never valid in a packet. */
    f32() { return finite(this.view.getFloat32(this.take(4), true)); }

    vec3(out) { return out.set(this.f32(), this.f32(), this.f32()); }

    unit16() { return this.u16() / 65535; }

    quat16(out) {
        out.set(this.i16() / 32767, this.i16() / 32767, this.i16() / 32767, this.i16() / 32767);
        // All zeros cannot be normalised into a rotation.
        if (out.lengthSq() < 1e-6) throw new PacketError('invalid rotation');
        return out.normalize();
    }

    /** Throws unless the whole packet has been read: trailing bytes mean it is not what it claims to be. */
    end() {
        if (this.remaining !== 0) throw new PacketError('packet is too long');
    }
}

function finite(value) {
    if (!Number.isFinite(value)) throw new PacketError('number is not finite');
    return value;
}

function clamp01(value) {
    return value > 1 ? 1 : value > 0 ? value : 0;
}

function toSnorm16(value) {
    return Math.round(Math.max(-1, Math.min(1, value)) * 32767);
}
