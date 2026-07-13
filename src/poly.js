// ---------- 2D polygon kernel (no DOM, node-testable) ----------
// Ported from grid-apps (Kiri:Moto) geo modules: point.js, slope.js, bounds.js,
// polygon.js, polygons.js. MIT license, Copyright Stewart Allen <sa@grid.space>.
// Trimmed to the 2.5D CAM surface cnc-studio needs: clipper-backed offset/expand,
// boolean ops (union/diff/xor/intersect/mask), nesting, winding, containment,
// open-path clipping (cut). Not ported: earcut/mesh/paths/arcs modules, fill
// rastering, wasm paths, THREE-dependent methods, FDM-specific helpers.
// Deviations from source are marked with PORT: comments.
// Requires the ClipperLib global (vendor/clip2.js, concatenated first in the
// browser bundle; required directly when running under node).
// Exposes ONE top-level name: POLY (kernel namespace; classes + factories inside).
const POLY = (function(){
"use strict";

// PORT: module glue replaced — resolve ClipperLib from browser global or node require
const ClipperLib = (typeof self!=='undefined' && self.ClipperLib) ? self.ClipperLib : require('../vendor/clip2.js');

const {
    Clipper,
    ClipType,
    PolyType,
    PolyFillType,
    EndType,
    JoinType,
    PolyTree,
    ClipperOffset
} = ClipperLib;

const CleanPolygon = Clipper.CleanPolygon,
    CleanPolygons = Clipper.CleanPolygons,
    SimplifyPolygons = Clipper.SimplifyPolygons,
    FillNonZero = PolyFillType.pftNonZero,
    FillEvenOdd = PolyFillType.pftEvenOdd,
    PathSubject = PolyType.ptSubject,
    PathClip = PolyType.ptClip,
    ClipXOR = ClipType.ctXor,
    ClipDiff = ClipType.ctDifference,
    ClipUnion = ClipType.ctUnion,
    ClipIntersect = ClipType.ctIntersection;

const DEG2RAD = Math.PI / 180,
    RAD2DEG = 180 / Math.PI,
    ABS = Math.abs;

// ---- base: key / config / util (subset of geo/base.js) ----

const key = {
    NONE: "",
    PROJECT: "project",
    SEGINT: "segint",
    RAYINT: "rayint",
    PARALLEL: "parallel"
};

function sqr(v) { return v * v; }

const config = {
    precision_offset: 0.05,
    precision_merge: 0.005,
    precision_merge_sq: sqr(0.005),
    precision_bounds: 0.0001,
    precision_point_on_line: 0.01,
    precision_close_to_poly_sq: sqr(0.001),
    precision_midpoint_check_dist: 1,
    precision_nested_sq: sqr(0.01),
    // simplified isEquivalent thresholds (PORT: geo.isEquivalent not ported)
    precision_poly_area: 0.05,
    precision_poly_bounds: 0.01,
    // clipper multiplier
    clipper: 100000,
    // clipper poly clean
    clipperClean: 250
};

const round_decimal_precision = 5;

function round(v, zeros) {
    const prec = zeros !== undefined ? zeros : round_decimal_precision;
    if (prec === 0) return v | 0;
    let pow = Math.pow(10, prec);
    return Math.round(v * pow) / pow;
}

function numOrDefault(num, def) {
    return num !== undefined ? num : def;
}

function isCloseTo(v1, v2, dist) {
    return Math.abs(v1 - v2) <= (dist ?? config.precision_merge);
}

function inCloseRange(val, min, max, precision) {
    return (isCloseTo(val, min, precision) || val >= min) && (isCloseTo(val, max, precision) || val <= max);
}

function distSq(p1, p2) {
    return sqr(p2.x - p1.x) + sqr(p2.y - p1.y);
}

function distSqv2(x1, y1, x2, y2) {
    return sqr(x2 - x1) + sqr(y2 - y1);
}

function doCombinations(a1, a2, arg, fn) {
    let i, j;
    for (i = 0; i < a1.length; i++) {
        for (j = (a1 === a2 ? i + 1 : 0); j < a2.length; j++) {
            fn(a1[i], a2[j], arg);
        }
    }
    return arg;
}

// used by Polygon.intersects
function intersect(p1, p2, p3, p4, test, parallelok) {
    let p1x = p1.x, p1y = p1.y,
        p2x = p2.x, p2y = p2.y,
        p3x = p3.x, p3y = p3.y,
        p4x = p4.x, p4y = p4.y,
        d1x = (p2x - p1x),
        d1y = (p2y - p1y),
        d2x = (p4x - p3x),
        d2y = (p4y - p3y),
        d = (d2y * d1x) - (d2x * d1y);

    if (Math.abs(d) < 0.0001) {
        return test && !parallelok ? null : key.PARALLEL;
    }

    let a = p1y - p3y,
        b = p1x - p3x,
        n1 = (d2x * a) - (d2y * b),
        n2 = (d1x * a) - (d1y * b);

    a = n1 / d;
    b = n2 / d;

    let ia = a >= -0.0001 && a <= 1.0001,
        ib = b >= -0.0001 && b <= 1.0001,
        segint = (ia && ib),
        rayint = (a >= 0 && b >= 0);

    if (test === key.SEGINT && !segint) return null;
    if (test === key.RAYINT && !rayint) return null;

    let ip = newPoint(
        p1x + (a * d1x),
        p1y + (a * d1y),
        p3.z || p4.z,
        segint ? key.SEGINT : rayint ? key.RAYINT : key.PROJECT
    );

    ip.dist = a;
    ip.p1 = p3;
    ip.p2 = p4;

    return ip;
}

const util = {
    sqr,
    round,
    distSq,
    distSqv2,
    isCloseTo,
    inCloseRange,
    numOrDefault,
    doCombinations,
    intersect
};

// PORT: Array.prototype extensions (append/appendAll/contains) replaced with helpers
function pushAll(dst, src) {
    if (src && src.length > 0) {
        if (src.length > 10000) {
            for (let i = 0, il = src.length; i < il; i++) dst.push(src[i]);
        } else {
            dst.push(...src);
        }
    }
    return dst;
}

function pushFlat(dst, v, flat) {
    if (flat) return pushAll(dst, v);
    dst.push(v);
    return dst;
}

// ---- Slope (geo/slope.js) ----

class Slope {
    constructor(p1, p2, dx, dy) {
        this.dx = p1 && p2 ? p2.x - p1.x : dx;
        this.dy = p1 && p2 ? p2.y - p1.y : dy;
        this.angle = Math.atan2(this.dy, this.dx) * RAD2DEG;
    }

    clone() {
        return new Slope(null, null, this.dx, this.dy);
    }

    isSame(s) {
        if (ABS(this.dx) <= config.precision_merge && ABS(s.dx) <= config.precision_merge) return true;
        if (ABS(this.dy) <= config.precision_merge && ABS(s.dy) <= config.precision_merge) return true;
        let prec = Math.min(1/Math.sqrt(this.dx * this.dx + this.dy * this.dy), 0.25);
        return angleWithinDelta(this.angle, s.angle, prec || 0.02);
    }

    normal() {
        let t = this.dx;
        this.dx = -this.dy;
        this.dy = t;
        this.angle = Math.atan2(this.dy, this.dx) * RAD2DEG;
        return this;
    }

    invert() {
        this.dx = -this.dx;
        this.dy = -this.dy;
        this.angle = Math.atan2(this.dy, this.dx) * RAD2DEG;
        return this;
    }

    toUnit() {
        let max = Math.max(ABS(this.dx), ABS(this.dy));
        this.dx = this.dx / max;
        this.dy = this.dy / max;
        return this;
    }

    factor(f) {
        this.dx *= f;
        this.dy *= f;
        return this;
    }

    angleDiff(s2, sign) {
        const n1 = this.angle;
        const n2 = s2.angle;
        let diff = n2 - n1;
        while (diff < -180) diff += 360;
        while (diff > 180) diff -= 360;
        return sign ? diff : Math.abs(diff);
    }
}

function angleWithinDelta(a1, a2, delta) {
    return (ABS(a1-a2) <= delta || 360-ABS(a1-a2) <= delta);
}

function newSlope(p1, p2, dx, dy) {
    return new Slope(p1, p2, dx, dy);
}

function newSlopeFromAngle(angle) {
    return newSlope(0, 0,
        Math.cos(angle * DEG2RAD),
        Math.sin(angle * DEG2RAD)
    );
}

// ---- Point (geo/point.js, trimmed) ----

class Point {
    constructor(x = 0, y = 0, z = 0, key) {
        this.x = x;
        this.y = y;
        this.z = z;
        if (key) {
            this._key = key;
        }
    }

    get key() {
        if (this._key) {
            return this._key;
        }
        return this._key = [
            ((this.x * 100000) | 0),
            ((this.y * 100000) | 0),
            ((this.z * 100000) | 0)
        ].join('');
    }

    toClipper() {
        return {
            X: (this.x * config.clipper) | 0,
            Y: (this.y * config.clipper) | 0
        };
    }

    toArray() {
        return [ this.x, this.y, this.z ];
    }

    set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        delete this._key;
        return this;
    }

    setX(x) { this.x = x; return this; }
    setY(y) { this.y = y; return this; }
    setZ(z) { this.z = z; return this; }

    rekey() {
        this._key = undefined;
    }

    clone(keys) {
        let p = newPoint(this.x, this.y, this.z, this._key);
        if (keys) {
            for (let key of keys) {
                p[key] = this[key];
            }
        }
        return p;
    }

    slopeTo(p) {
        return newSlope(this, p);
    }

    isNear(p, dist) {
        return isCloseTo(this.x, p.x, dist) && isCloseTo(this.y, p.y, dist);
    }

    distToLine(p1, p2) {
        return Math.sqrt(this.distToLineSq(p1, p2));
    }

    distToLineSq(p1, p2) {
        let p = this,
            d = distSq(p1, p2);

        let t = ((p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y)) / d;

        if (t < 0) return distSq(p, p1);
        if (t > 1) return distSq(p, p2);

        return distSqv2(p.x, p.y, p1.x + t * (p2.x - p1.x), p1.y + t * (p2.y - p1.y));
    }

    withinDist2(p1, p2, dist2) {
        let ll2 = p1.distToSq2D(p2),
            dp1 = this.distToSq2D(p1),
            dp2 = this.distToSq2D(p2);
        if (ll2 < dist2) {
            ll2 += dist2;
            if (dp1 > ll2 && dp2 > ll2) return false;
        }
        if (dp1 > ll2 && dp2 > ll2) return false;
        return this.distToLineSq(p1, p2) < dist2;
    }

    midPointTo(p2) {
        return newPoint((this.x + p2.x) / 2, (this.y + p2.y) / 2, this.z);
    }

    midPointTo3D(p2) {
        return newPoint(
            (this.x + p2.x) / 2,
            (this.y + p2.y) / 2,
            (this.z + p2.z) / 2
        );
    }

    projectOnSlope(slope, mult) {
        return newPoint(
            this.x + slope.dx * mult,
            this.y + slope.dy * mult,
            this.z);
    }

    followTo(point, mult) {
        return this.follow(this.slopeTo(point), mult);
    }

    follow(slope, distance) {
        let ls = distance / Math.sqrt(slope.dx * slope.dx + slope.dy * slope.dy);
        return newPoint(this.x + slope.dx * ls, this.y + slope.dy * ls, this.z);
    }

    offsetPointTo(p2, dist) {
        let p1 = this,
            dx = p2.x - p1.x,
            dy = p2.y - p1.y;

        if (dx === 0 && dy === 0) return this;

        let ls = dist / Math.sqrt(dx * dx + dy * dy),
            ox = dx * ls,
            oy = dy * ls;

        return newPoint(p1.x + ox, p1.y + oy, p2.z, key.NONE);
    }

    offsetPointFrom(p2, dist) {
        let p1 = this,
            dx = p2.x - p1.x,
            dy = p2.y - p1.y,
            ls = dist / Math.sqrt(dx * dx + dy * dy),
            ox = dx * ls,
            oy = dy * ls;
        return newPoint(p2.x - ox, p2.y - oy, p2.z, key.NONE);
    }

    offset(x, y, z) {
        return newPoint(this.x + x, this.y + y, this.z + z);
    }

    inPolygon(poly) {
        if (!poly.bounds.containsXY(this.x, this.y)) return false;

        let p = poly.points,
            pl = p.length,
            p1, p2, i, inside = false;

        for (i = 0; i < pl; i++) {
            p1 = p[i];
            p2 = p[(i + 1) % pl];
            if ((p1.y >= this.y) != (p2.y >= this.y) &&
                (this.x <= (p2.x - p1.x) * (this.y - p1.y) / (p2.y - p1.y) + p1.x)) {
                inside = !inside;
            }
        }

        return inside;
    }

    isInPolygon(poly) {
        let point = this,
            i;
        if (Array.isArray(poly)) {
            for (i = 0; i < poly.length; i++) {
                if (point.isInPolygon(poly[i])) return true;
            }
            return false;
        }
        let holes = poly.inner;
        if (point.inPolygon(poly) || point.nearPolygon(poly, config.precision_merge_sq)) {
            for (i = 0; holes && i < holes.length; i++) {
                if (point.inPolygon(holes[i]) && !point.nearPolygon(holes[i], config.precision_merge_sq)) return false;
            }
            return true;
        }
        return false;
    }

    isInPolygonOnly(poly) {
        let point = this,
            i;
        if (Array.isArray(poly)) {
            for (i = 0; i < poly.length; i++) {
                if (point.isInPolygonOnly(poly[i])) {
                    return true;
                }
            }
            return false;
        }
        let holes = poly.inner;
        if (point.inPolygon(poly)) {
            for (i = 0; holes && i < holes.length; i++) {
                if (point.inPolygon(holes[i])) return false;
            }
            return true;
        }
        return false;
    }

    nearPolygon(poly, dist2, inner) {
        for (let i = 0, p = poly.points, pl = p.length; i < pl; i++) {
            if (this.withinDist2(p[i], p[(i + 1) % pl], dist2)) {
                return true;
            }
        }
        if (inner && poly.inner) {
            for (let i = 0; i < poly.inner.length; i++) {
                if (this.nearPolygon(poly.inner[i], dist2)) return true;
            }
        }
        return false;
    }

    insideOffset(poly, offset, mindist2) {
        return this.inPolygon(poly) === (offset > 0) && !this.nearPolygon(poly, mindist2);
    }

    intersectZ(p, z) {
        let dx = p.x - this.x,
            dy = p.y - this.y,
            dz = p.z - this.z,
            pct = 1 - ((p.z - z) / dz);
        return newPoint(this.x + dx * pct, this.y + dy * pct, this.z + dz * pct);
    }

    isEqual2D(p) {
        return this === p || (this.x === p.x && this.y === p.y);
    }

    isMergable2D(p) {
        return this.isEqual2D(p) || (this.distToSq2D(p) < config.precision_merge_sq);
    }

    isEqual(p) {
        return this === p || (this.x === p.x && this.y === p.y && this.z === p.z);
    }

    isMergable3D(p) {
        return this.isEqual(p) || (this.distToSq3D(p) < config.precision_merge_sq);
    }

    isInBox(p, dist) {
        return Math.abs(this.x - p.x) < dist && Math.abs(this.y - p.y) < dist;
    }

    distToPolySegments(poly, threshold) {
        let point = this,
            mindist = Infinity;
        poly.forEachSegment(function(p1, p2) {
            const nextdist = Math.min(mindist, point.distToLine(p1, p2));
            mindist = Math.min(nextdist, mindist);
            if (mindist <= threshold) return true;
        });
        return mindist;
    }

    nearestTo(points, max) {
        if (!max) throw "missing max";
        let mind = Infinity,
            minp = null,
            i, p, d;
        for (i = 0; i < points.length; i++) {
            p = points[i];
            if (p === this || p.del) continue;
            d = this.distToSq2D(p);
            if (d < max && d < mind) {
                mind = d;
                minp = p;
            }
        }
        return minp;
    }

    distTo2D(p) {
        let dx = this.x - p.x,
            dy = this.y - p.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    distToSq2D(p) {
        let dx = this.x - p.x,
            dy = this.y - p.y;
        return dx * dx + dy * dy;
    }

    distTo3D(p) {
        let dx = this.x - p.x,
            dy = this.y - p.y,
            dz = this.z - p.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    distToSq3D(p) {
        let dx = this.x - p.x,
            dy = this.y - p.y,
            dz = this.z - p.z;
        return dx * dx + dy * dy + dz * dz;
    }

    onLine(p1, p2) {
        return this.distToLine(p1, p2) < config.precision_point_on_line;
    }

    add(delta) {
        return newPoint(this.x + delta.x, this.y + delta.y, this.z + delta.z);
    }

    sub(delta) {
        return newPoint(this.x - delta.x, this.y - delta.y, this.z - delta.z);
    }

    move(delta) {
        this.x += delta.x;
        this.y += delta.y;
        this.z += delta.z;
        return this;
    }

    rotate(angle) {
        const { x, y } = this;
        this.x = x * Math.cos(angle) - y * Math.sin(angle);
        this.y = y * Math.cos(angle) + x * Math.sin(angle);
        return this;
    }
}

function newPoint(x, y, z, key) {
    return new Point(x, y, z, key);
}

function pointFromClipper(cp, z) {
    return newPoint(cp.X / config.clipper, cp.Y / config.clipper, z);
}

// ---- Bounds (geo/bounds.js) ----

class Bounds {
    constructor() {
        this.minx = 10e7;
        this.miny = 10e7;
        this.maxx = -10e7;
        this.maxy = -10e7;
    }

    set(minx, maxx, miny, maxy) {
        this.minx = minx;
        this.miny = miny;
        this.maxx = maxx;
        this.maxy = maxy;
        return this;
    }

    clone() {
        let b = new Bounds();
        b.minx = this.minx;
        b.miny = this.miny;
        b.maxx = this.maxx;
        b.maxy = this.maxy;
        return b;
    }

    equals(bounds, margin) {
        if (!margin) margin = config.precision_offset;
        return isCloseTo(this.minx, bounds.minx, margin) &&
            isCloseTo(this.miny, bounds.miny, margin) &&
            isCloseTo(this.maxx, bounds.maxx, margin) &&
            isCloseTo(this.maxy, bounds.maxy, margin);
    }

    delta(bounds) {
        return 0 +
            Math.abs(this.minx - bounds.minx) +
            Math.abs(this.miny - bounds.miny) +
            Math.abs(this.maxx - bounds.maxx) +
            Math.abs(this.maxy - bounds.maxy);
    }

    merge(b) {
        this.minx = Math.min(this.minx, b.minx);
        this.maxx = Math.max(this.maxx, b.maxx);
        this.miny = Math.min(this.miny, b.miny);
        this.maxy = Math.max(this.maxy, b.maxy);
        return this;
    }

    update(p) {
        this.minx = Math.min(this.minx, p.x);
        this.maxx = Math.max(this.maxx, p.x);
        this.miny = Math.min(this.miny, p.y);
        this.maxy = Math.max(this.maxy, p.y);
        return this;
    }

    contains(bounds) {
        return bounds.isNested(this);
    }

    containsXY(x, y) {
        return x >= this.minx && x <= this.maxx && y >= this.miny && y <= this.maxy;
    }

    containsOffsetXY(x, y, offset) {
        return x >= this.minx - offset && x <= this.maxx + offset && y >= this.miny - offset && y <= this.maxy + offset;
    }

    isNested(parent, precision = config.precision_bounds) {
        return (
            this.minx >= parent.minx - precision &&
            this.maxx <= parent.maxx + precision &&
            this.miny >= parent.miny - precision &&
            this.maxy <= parent.maxy + precision
        );
    }

    overlaps(b, precision = config.precision_bounds) {
        return (
            Math.abs(this.centerx() - b.centerx()) * 2 - precision < this.width() + b.width() &&
            Math.abs(this.centery() - b.centery()) * 2 - precision < this.height() + b.height()
        );
    }

    width() { return this.maxx - this.minx; }
    height() { return this.maxy - this.miny; }

    center(z = 0) {
        return newPoint(this.centerx(), this.centery(), z);
    }

    centerx() { return this.minx + this.width() / 2; }
    centery() { return this.miny + this.height() / 2; }
}

function newBounds() {
    return new Bounds();
}

// ---- Polygon (geo/polygon.js, trimmed) ----

let seqid = Math.round(Math.random() * 0xffffffff);

class Polygon {
    constructor(points) {
        this.id = seqid++;
        this.open = false;
        this.points = [];
        this.depth = 0;
        if (points) {
            this.addPoints(points);
        }
    }

    get length() {
        return this.points.length;
    }

    get deepLength() {
        let len = this.length;
        if (this.inner) {
            for (let inner of this.inner) {
                len += inner.length;
            }
        }
        return len;
    }

    get bounds() {
        if (this._bounds) {
            return this._bounds;
        }
        let bounds = this._bounds = newBounds();
        for (let point of this.points) {
            bounds.update(point);
        }
        return bounds;
    }

    toArray() {
        let ov = this.open ? 1 : 0;
        return this.points.map((p, i) => i === 0 ? [ov, p.x, p.y, p.z] : [p.x, p.y, p.z]).flat();
    }

    fromArray(array) {
        this.open = array[0] === 1;
        for (let i = 1; i < array.length;) {
            this.add(array[i++], array[i++], array[i++]);
        }
        return this;
    }

    first() {
        return this.points[0];
    }

    last() {
        return this.points[this.length - 1];
    }

    average() {
        let ap = newPoint(0, 0, 0, null);
        this.points.forEach(p => {
            ap.x += p.x;
            ap.y += p.y;
            ap.z += p.z;
        });
        ap.x /= this.points.length;
        ap.y /= this.points.length;
        ap.z /= this.points.length;
        return ap;
    }

    center() {
        return this.bounds.center(this.getZ());
    }

    centerRectangle(center, width, height) {
        width /= 2;
        height /= 2;
        this.push(newPoint(center.x - width, center.y - height, center.z));
        this.push(newPoint(center.x + width, center.y - height, center.z));
        this.push(newPoint(center.x + width, center.y + height, center.z));
        this.push(newPoint(center.x - width, center.y + height, center.z));
        return this;
    }

    centerCircle(center, radius, points, clockwise) {
        let angle = 0,
            add = 360 / points;
        if (clockwise) add = -add;
        while (points-- > 0) {
            this.push(newPoint(
                round(Math.cos(angle * DEG2RAD) * radius, 7) + center.x,
                round(Math.sin(angle * DEG2RAD) * radius, 7) + center.y,
                center.z
            ));
            angle += add;
        }
        return this;
    }

    move(offset, skipinner) {
        this._bounds = undefined;
        this.points = this.points.map(point => point.move(offset));
        if (!skipinner && this.inner) {
            for (let inner of this.inner) {
                inner.move(offset);
            }
        }
        return this;
    }

    // PORT: round param uses util.round (source used Number.prototype.round extension)
    scale(scale, rnd) {
        this.area2 = undefined;
        let x, y, z;
        if (typeof(scale) === 'number') {
            x = y = z = scale;
        } else {
            x = scale.x;
            y = scale.y;
            z = scale.z;
        }
        this._bounds = undefined;
        this.points.forEach(point => {
            if (rnd) {
                point.x = round(point.x * x, rnd);
                point.y = round(point.y * y, rnd);
                point.z = round(point.z * z, rnd);
            } else {
                point.x = point.x * x;
                point.y = point.y * y;
                point.z = point.z * z;
            }
        });
        if (this.inner) {
            for (let inner of this.inner) {
                inner.scale(scale, rnd);
            }
        }
        return this;
    }

    rotate(degrees) {
        let rad = degrees * DEG2RAD;
        if (rad)
        this.points = this.points.map(p => {
            let x = p.x * Math.cos(rad) - p.y * Math.sin(rad);
            let y = p.y * Math.cos(rad) + p.x * Math.sin(rad);
            p.x = x;
            p.y = y;
            return p;
        });
        return this;
    }

    clone(deep, fields) {
        let np = newPolygon().copyZ(this.getZ()),
            ln = this.length,
            i = 0;

        while (i < ln) np.push(this.points[i++]);

        fields && fields.forEach(field => np[field] = this[field]);
        np.depth = this.depth;
        np.open = this.open;

        if (deep && this.inner) {
            np.inner = this.inner.map(ip => ip.clone(false, fields));
        }

        return np;
    }

    cloneZ(z, deep = true) {
        let p = newPolygon();
        p.z = z;
        p.open = this.open;
        p.points = this.points;
        if (deep && this.inner) {
            p.inner = this.inner.map(ip => ip.cloneZ(z, false));
        }
        return p;
    }

    copyZ(z) {
        if (z !== undefined) {
            this.z = z;
        }
        return this;
    }

    setZ(z) {
        let ar = this.points,
            ln = ar.length,
            i = 0;
        while (i < ln) ar[i++].z = z;
        this.z = z;
        if (this.inner) this.inner.forEach(c => c.setZ(z));
        return this;
    }

    getZ(i) {
        return this.z !== undefined ? this.z : this.points[i || 0]?.z || 0;
    }

    minZ() {
        let minZ = Math.min(...this.points.map(p => p.z));
        if (this.inner) {
            for (let i of this.inner) {
                minZ = Math.min(minZ, i.minZ());
            }
        }
        return minZ;
    }

    // PORT: source had `Math.max(minZ, ...)` here — an undefined-var bug. Fixed.
    maxZ() {
        let maxZ = Math.max(...this.points.map(p => p.z));
        if (this.inner) {
            for (let i of this.inner) {
                maxZ = Math.max(maxZ, i.maxZ());
            }
        }
        return maxZ;
    }

    add(x, y, z) {
        this.push(newPoint(x, y, z));
        return this;
    }

    addObj(obj) {
        if (Array.isArray(obj)) {
            for (let o of obj) {
                this.addObj(o);
            }
            return this;
        }
        return this.add(obj.x, obj.y, obj.z);
    }

    addPoints(points) {
        let poly = this,
            length = points.length,
            i = 0;
        while (i < length) {
            poly.push(points[i++]);
        }
        return this;
    }

    addVerts(verts) {
        for (let i = 0; i < verts.length; ) {
            this.add(
                verts[i++],
                verts[i++],
                verts[i++]
            );
        }
        return this;
    }

    push(p) {
        this.area2 = undefined;
        if (p.poly) p = p.clone();
        p.poly = this;
        this.points.push(p);
        return p;
    }

    append(p) {
        this.push(p);
        return this;
    }

    setClosed() {
        this.open = false;
        return this;
    }

    setOpen() {
        this.open = true;
        return this;
    }

    setOpenValue(b) {
        this.open = b;
        return this;
    }

    isOpen() {
        return this.open;
    }

    isClosed() {
        return !this.open;
    }

    appearsClosed() {
        return this.first().isEqual(this.last());
    }

    closeIf(dist = 1) {
        let closeDist = this.first().distTo2D(this.last());
        if (closeDist < 0.001) {
            this.points.pop();
            return this.setClosed();
        } else if (closeDist <= dist) {
            return this.setClosed();
        } else {
            return this.setOpen();
        }
    }

    fixClosed() {
        if (this.appearsClosed()) {
            this.points.pop();
            this.open = false;
        }
        return this;
    }

    setClockwise() {
        if (!this.isClockwise()) this.reverse();
        return this;
    }

    setCounterClockwise() {
        if (this.isClockwise()) this.reverse();
        return this;
    }

    isClockwise() {
        return this.area(true) > 0;
    }

    alignWinding(poly, toLongest) {
        if (toLongest && this.length > poly.length) {
            poly.alignWinding(this, false);
        } else if (this.isClockwise() !== poly.isClockwise()) {
            this.reverse();
        }
        return this;
    }

    opposeWinding(poly, toLongest) {
        if (toLongest && this.length > poly.length) {
            poly.opposeWinding(this, false);
        } else if (this.isClockwise() === poly.isClockwise()) {
            this.reverse();
        }
        return this;
    }

    sameWindings(poly) {
        return this.isClockwise() === poly.isClockwise();
    }

    reverse() {
        if (this.area2) {
            this.area2 = -this.area2;
        }
        this.points = this.points.reverse();
        return this;
    }

    isNested(parent) {
        if (parent.bounds.contains(this.bounds)) {
            return this.isInside(parent, config.precision_nested_sq);
        }
        return false;
    }

    forEachPoint(fn, close, start) {
        let index = start || 0,
            points = this.points,
            length = points.length,
            count = close ? length + 1 : length,
            offset = 0,
            pos;

        while (count-- > 0) {
            pos = index % length;
            if (fn(points[pos], pos, points, offset++)) return;
            index++;
        }
    }

    forEachSegment(fn, open, start) {
        let index = start || 0,
            points = this.points,
            length = points.length,
            count = open ? length - 1 : length,
            pos1, pos2;

        while (count-- > 0) {
            pos1 = index % length;
            pos2 = (index + 1) % length;
            if (fn(points[pos1], points[pos2], pos1, pos2)) return;
            index++;
        }
    }

    intersects(poly) {
        let p0 = this.points.slice(); p0.push(p0[0]);
        let p1 = poly.points.slice(); p1.push(p1[0]);
        for (let i = 1; i < p0.length; i++) {
            let a = p0[i-1];
            let b = p0[i];
            for (let j = 1; j < p1.length; j++) {
                let c = p1[j-1];
                let d = p1[j];
                if (intersect(a, b, c, d, key.SEGINT)) {
                    return true;
                }
            }
        }
        return false;
    }

    hasPointsInside(poly, tolerance) {
        if (!poly.overlaps(this)) return false;

        let mid, exit = false;

        this.forEachSegment((prev, next) => {
            if (prev.distTo2D(next) > config.precision_midpoint_check_dist) {
                mid = prev.midPointTo(next);
                if (mid.inPolygon(poly) || mid.nearPolygon(poly, tolerance || config.precision_close_to_poly_sq)) {
                    return exit = true;
                }
            }
            if (next.inPolygon(poly) || next.nearPolygon(poly, tolerance || config.precision_close_to_poly_sq)) {
                return exit = true;
            }
        });

        return exit;
    }

    isNear(poly, radius, cache) {
        const midcheck = config.precision_midpoint_check_dist;
        const dist = radius || config.precision_close_to_poly_sq;
        let near = false;
        let mem = cache ? this.cacheNear = this.cacheNear || {} : undefined;

        if (mem && mem[poly.id] !== undefined) {
            return mem[poly.id];
        }

        this.forEachSegment((prev, next) => {
            if (prev.distToSq2D(next) > midcheck) {
                if (prev.midPointTo(next).nearPolygon(poly, dist)) {
                    return near = true;
                }
            }
            if (next.nearPolygon(poly, dist)) {
                return near = true;
            }
        });

        if (mem) {
            mem[poly.id] = near;
        }

        return near;
    }

    isInside(poly, tolerance) {
        const neardist = tolerance || config.precision_close_to_poly_sq;
        if (!this.bounds.isNested(poly.bounds, neardist * 3)) {
            return false;
        }

        let mid,
            midcheck = config.precision_midpoint_check_dist,
            exit = true;

        this.forEachSegment((prev, next) => {
            if (prev.distTo2D(next) > midcheck) {
                mid = prev.midPointTo(next);
                if (!(mid.inPolygon(poly) || mid.nearPolygon(poly, neardist))) {
                    exit = false;
                    return true;
                }
            }
            if (!(next.inPolygon(poly) || next.nearPolygon(poly, neardist))) {
                exit = false;
                return true;
            }
        }, this.open);

        return exit;
    }

    // PORT: implemented per the spec commented out in source (contains was
    // referenced by setContains/containedBySet but not defined)
    contains(poly, tolerance) {
        if (!(poly && poly.isInside(this, tolerance))) return false;
        if (this.inner) {
            for (let i of this.inner) {
                if (poly.isInside(i, tolerance)) return false;
            }
        }
        return true;
    }

    containedBySet(polys) {
        if (!polys) return false;
        for (let i = 0; i < polys.length; i++) {
            if (polys[i].contains(this)) return true;
        }
        return false;
    }

    addInner(child) {
        child.parent = this;
        if (this.inner) {
            this.inner.push(child);
        } else {
            this.inner = [child];
        }
        return this;
    }

    innerCount() {
        return this.inner ? this.inner.length : 0;
    }

    hasInner() {
        return this.inner && this.inner.length > 0;
    }

    clearInner() {
        this.inner = null;
        return this;
    }

    circularity() {
        try {
            return (4 * Math.PI * this.area()) / sqr(this.perimeter());
        } catch (e) {
            return 0;
        }
    }

    circularityDeep() {
        return (4 * Math.PI * this.areaDeep()) / sqr(this.perimeter());
    }

    perimeter() {
        if (this.perim) {
            return this.perim;
        }

        let len = 0.0;

        this.forEachSegment((prev, next) => {
            len += Math.sqrt(prev.distToSq2D(next));
        }, this.open);

        return this.perim = len;
    }

    perimeterDeep() {
        let len = this.perimeter();
        if (this.inner) this.inner.forEach(p => {
            len += p.perimeter()
        });
        return len;
    }

    area(raw) {
        if (this.length < 3) {
            return 0;
        }
        if (this.area2 === undefined) {
            this.area2 = 0.0;
            for (let p = this.points, pl = p.length, pi = 0, p1, p2; pi < pl; pi++) {
                p1 = p[pi];
                p2 = p[(pi + 1) % pl];
                this.area2 += (p2.x - p1.x) * (p2.y + p1.y);
            }
        }
        return raw ? this.area2 : Math.abs(this.area2 / 2);
    }

    areaDeep() {
        if (!this.inner) {
            return this.area();
        }
        let i, c = this.inner,
            a = this.area();
        for (i = 0; i < c.length; i++) {
            a -= c[i].area();
        }
        return a;
    }

    thickness(deep) {
        if (deep) {
            return 2 * this.areaDeep() / this.perimeterDeep();
        } else {
            return 2 * this.area() / this.perimeter();
        }
    }

    overlaps(poly) {
        return this.bounds.overlaps(poly.bounds, config.precision_merge);
    }

    fromXYArray(arr, z) {
        let i = 0;
        while (i < arr.length) {
            this.add(arr[i++], arr[i++], z || 0);
        }
        return this;
    }

    simple() {
        return this.clean(true, undefined, Math.min(config.clipper / 10, config.clipperClean * 5));
    }

    clean(deep, parent, merge = config.clipperClean) {
        let clean = CleanPolygon(this.toClipper()[0], merge),
            poly = fromClipperPath(clean, this.getZ());
        if (poly.length === 0) return this;
        if (deep && this.inner) {
            poly.inner = this.inner.map(inr => inr.clean(false, poly, merge));
        }
        poly.parent = parent || this.parent;
        poly.area2 = this.area2;
        poly.open = this.open;
        if (this.open) {
            let start = this.points[0];
            let points = poly.points;
            let length = points.length;
            let mi, min = Infinity;
            for (let i = 0; i < length; i++) {
                let d = points[i].distTo2D(start);
                if (d < min) {
                    min = d;
                    mi = i;
                }
            }
            if (mi) {
                let nupoints = [];
                for (let i = mi; i < length; i++) {
                    nupoints.push(points[i]);
                }
                for (let i = 0; i < mi; i++) {
                    nupoints.push(points[i]);
                }
                poly.points = nupoints;
            }
        }
        return poly;
    }

    toClipper(inout) {
        let poly = this,
            out = inout || [];
        out.push(poly.points.map(p => p.toClipper()));
        if (poly.inner) {
            for (let inner of poly.inner) {
                inner.toClipper(out);
            }
        }
        return out;
    }

    /**
     * offset from source: positive = inset, negative = outset
     */
    offset(offset, output) {
        return expand([this], -offset, this.getZ(), output);
    }

    offset_open(distance, type = 'miter', miterLimit = 2) {
        if (this.isOpen()) {
            let coff = new ClipperOffset(),
                dudd = (coff.MiterLimit = miterLimit),
                tree = new PolyTree(),
                entt = {
                    'square': EndType.etOpenSquare,
                    'round': EndType.etOpenRound,
                    'miter': EndType.etOpenSquare
                }[type] || EndType.etOpenSquare,
                jntt = {
                    'square': JoinType.jtSquare,
                    'round': JoinType.jtRound,
                    'miter': JoinType.jtMiter
                }[type] || JoinType.jtMiter;
            coff.AddPaths(this.toClipper(), jntt, entt);
            coff.Execute(tree, distance * config.clipper);
            return fromClipperTree(tree, this.getZ(), null, null, 0);
        } else {
            return this.offset(distance);
        }
    }

    // PORT: simplified stand-in for geo.isEquivalent (not ported): compares
    // open state, area, bounds and mutual containment at merge tolerance
    isEquivalent(poly, recurse, precision) {
        if (this === poly) return true;
        if (this.open !== poly.open) return false;
        if (Math.abs(this.area() - poly.area()) > config.precision_poly_area) return false;
        if (this.bounds.delta(poly.bounds) > config.precision_poly_bounds * 4) return false;
        return this.isInside(poly, precision || sqr(config.precision_offset)) &&
               poly.isInside(this, precision || sqr(config.precision_offset));
    }

    findClosestPointTo(target) {
        let dist,
            index,
            closest,
            mindist = Infinity;

        if (this.open) {
            let d0 = target.distTo2D(this.first());
            let d1 = target.distTo2D(this.last());
            mindist = Math.min(d0, d1);
            closest = d0 < d1 ? this.first() : this.last();
            index = d0 < d1 ? 0 : this.points.length - 1;
        } else {
            this.forEachPoint((point, pos) => {
                dist = Math.sqrt(point.distToSq2D(target));
                if (dist < mindist) {
                    index = pos;
                    mindist = dist;
                    closest = point;
                }
            });
        }

        return {
            distance: mindist,
            point: closest,
            index: index,
            poly: this
        };
    }

    flattenTo(out, deep, crush) {
        out.push(this);
        if (deep) {
            if (deep.indexOf(this) >= 0) {
                return;
            }
            deep.push(this);
        }
        if (this.inner) {
            for (let p of this.inner) {
                p.flattenTo(out, deep, crush);
            }
        }
        if (crush) {
            this.inner = undefined;
        }
        return out;
    }

    diff(poly) {
        let clip = new Clipper(),
            tree = new PolyTree(),
            sp1 = this.toClipper(),
            sp2 = poly.toClipper();

        clip.AddPaths(sp1, PathSubject, true);
        clip.AddPaths(sp2, PathClip, true);

        if (clip.Execute(ClipDiff, tree, FillEvenOdd, FillEvenOdd)) {
            return fromClipperTree(tree, poly.getZ());
        } else {
            return null;
        }
    }

    xor(poly) {
        let clip = new Clipper(),
            tree = new PolyTree(),
            sp1 = this.toClipper(),
            sp2 = poly.toClipper();

        clip.AddPaths(sp1, PathSubject, true);
        clip.AddPaths(sp2, PathClip, true);

        if (clip.Execute(ClipXOR, tree, FillNonZero, FillNonZero)) {
            return fromClipperTree(tree, poly.getZ());
        } else {
            return null;
        }
    }

    mask(poly, nullOnEquiv, minarea) {
        let clip = new Clipper(),
            tree = new PolyTree(),
            sp1 = this.toClipper(),
            sp2 = poly.toClipper();

        clip.AddPaths(sp1, PathSubject, true);
        clip.AddPaths(sp2, PathClip, true);

        if (clip.Execute(ClipIntersect, tree, FillEvenOdd, FillEvenOdd)) {
            let out = fromClipperTree(tree, this.getZ(), undefined, undefined, minarea);
            if (nullOnEquiv && out.length === 1 && out[0].isEquivalent(this)) {
                return null;
            }
            return out;
        } else {
            return null;
        }
    }

    // cut poly using array of closed polygons. used primarily in cnc
    // to cut perimeters using masks resulting in open poly lines.
    cut(polys, inter) {
        let target = this;

        if (!target.open) {
            target = this.clone(true).setOpen();
            target.push(target.first());
            if (target.inner) {
                target.inner.forEach(ip => {
                    ip.setOpen();
                    ip.push(ip.first());
                });
            }
        }

        let clip = new Clipper(),
            tree = new PolyTree(),
            type = inter ? ClipIntersect : ClipDiff,
            sp1 = target.toClipper(),
            sp2 = toClipper(polys);

        clip.AddPaths(sp1, PathSubject, false);
        clip.AddPaths(sp2, PathClip, true);

        if (clip.Execute(type, tree, FillEvenOdd, FillEvenOdd)) {
            let cuts = fromClipperTree(tree, target.getZ(), null, null, 0);
            cuts.forEach(no => {
                if (no.open && no.first().distTo2D(no.last()) < 0.001) {
                    no.open = false;
                    no.points.pop();
                }
                no.depth = this.depth;
            });
            return cuts;
        } else {
            return null;
        }
    }

    intersect(poly, min) {
        if (!this.overlaps(poly)) return null;

        if (this.isInside(poly)) {
            return [this];
        }

        let clip = new Clipper(),
            tree = new PolyTree(),
            sp1 = this.toClipper(),
            sp2 = poly.toClipper(),
            minarea = min >= 0 ? min : 0.1;

        clip.AddPaths(sp1, PathSubject, true);
        clip.AddPaths(sp2, PathClip, true);

        if (clip.Execute(ClipIntersect, tree, FillNonZero, FillNonZero)) {
            let inter = fromClipperTreeUnion(tree, poly.getZ(), minarea)
                .filter(p => p.isInside(this));
            return inter;
        }

        return null;
    }

    areaDiff(poly) {
        let a1 = this.area(),
            a2 = poly.area();
        return (a1 > a2) ? a2 / a1 : a1 / a2;
    }

    simplify(opt = {}) {
        let z = this.getZ();

        if (opt.pump) {
            let p2 = offset([this], opt.pump, { z });
            if (p2) {
                p2 = offset(p2, -opt.pump, { z });
                return p2;
            }
            return null;
        }

        let clip = this.toClipper(),
            res = Clipper.SimplifyPolygons(clip, FillNonZero);

        if (!(res && res.length)) {
            return null;
        }

        return res.map(array => {
            let poly = newPolygon();
            for (let pt of array) {
                poly.push(pointFromClipper(pt, z));
            }
            return poly;
        });
    }

    union(poly, min, all) {
        if (!this.overlaps(poly)) return null;

        let clip = new Clipper(),
            tree = new PolyTree(),
            sp1 = this.toClipper(),
            sp2 = poly.toClipper();

        clip.AddPaths(sp1, PathSubject, true);
        clip.AddPaths(sp2, PathClip, true);

        if (clip.Execute(ClipUnion, tree, FillEvenOdd, FillEvenOdd)) {
            let u = fromClipperTreeUnion(tree, poly.getZ(), min ?? 0);
            let length = u.length;
            if (all) {
                return length === 2 ? null : u;
            } else if (length === 1) {
                return u[0];
            }
        }

        return null;
    }

    annotate(obj = {}) {
        Object.assign(this, obj);
        return this;
    }
}

function fromClipperPath(path, z) {
    let poly = newPolygon(),
        i = 0,
        l = path.length;
    while (i < l) {
        poly.push(pointFromClipper(path[i++], z));
    }
    return poly;
}

function newPolygon(points) {
    return new Polygon(points);
}

// ---- polygons namespace (geo/polygons.js, trimmed) ----

function verify(polys) {
    polys.forEach(p => {
        if (!p.open && p.length < 3) console.trace('SHORT', p);
        if (!p.open && p.area() < 0.001) console.trace('SMALL', p);
        p.points.forEach(pt => {
            if (isNaN(pt.x) || isNaN(pt.y) || isNaN(pt.z)) {
                console.trace('NaN', pt);
            }
        });
    });
}

function outer(polys) {
    for (let p of polys) {
        p.inner = undefined;
    }
    return polys;
}

function inner(polys) {
    const ret = [];
    for (let p of polys) {
        if (p.inner) {
            ret.push(p.inner);
        }
    }
    return ret;
}

function length(polys) {
    let len = 0;
    for (let p of polys) {
        len += p.deepLength;
    }
    return len;
}

function setZ(polys, z) {
    for (let poly of polys) {
        poly.setZ(z);
    }
    return polys;
}

function clearInner(polys) {
    for (let p of polys) {
        p.clearInner();
    }
}

function toClipper(polys = []) {
    let out = [];
    for (let poly of polys) {
        poly.toClipper(out);
    }
    return out;
}

function fromClipperNode(tnode, z) {
    let poly = newPolygon();
    for (let point of tnode.m_polygon) {
        poly.push(pointFromClipper(point, z));
    }
    poly.open = tnode.IsOpen;
    return poly;
}

function fromClipperTree(tnode, z, tops, parent, minarea) {
    let poly,
        polys = tops || [],
        min = minarea ?? 0.1;

    for (let child of tnode.m_Childs) {
        poly = fromClipperNode(child, z);
        if (!poly.open && poly.area() < min) {
            continue;
        }
        if (parent) {
            parent.addInner(poly);
        } else {
            polys.push(poly);
        }
        if (child.m_Childs) {
            fromClipperTree(child, z, polys, parent ? null : poly, min);
        }
    }

    return polys;
}

function fromClipperTreeUnion(tnode, z, minarea, tops, parent) {
    let polys = tops || [], poly;

    for (let child of tnode.m_Childs) {
        poly = fromClipperNode(child, z);
        if (!poly.open && minarea && poly.area() < minarea) {
            continue;
        }
        if (parent) {
            parent.addInner(poly);
        } else {
            polys.push(poly);
        }
        if (child.m_Childs) {
            fromClipperTreeUnion(child, z, minarea, polys, parent ? null : poly);
        }
    }

    return polys;
}

function cleanClipperTree(tree) {
    if (tree.m_Childs)
    for (let child of tree.m_Childs) {
        child.m_polygon = CleanPolygon(child.m_polygon, config.clipperClean);
        cleanClipperTree(child.m_Childs);
    }

    return tree;
}

function filter(array, output, fn) {
    for (let poly of array) {
        poly = fn(poly);
        if (poly) {
            if (Array.isArray(poly)) {
                pushAll(output, poly);
            } else {
                output.push(poly);
            }
        }
    }
    return output;
}

function points(polys) {
    return polys.length ? polys.map(p => p.deepLength).reduce((a,v) => a+v) : 0;
}

function renest(polygons, deep) {
    return nest(flatten(polygons, [], true), deep);
}

function nest(polygons, deep, opentop) {
    if (!polygons) {
        return polygons;
    }
    polygons.sort(function (a, b) {
        return a.area() - b.area();
    });
    let i, poly;
    for (i = 0; i < polygons.length; i++) {
        poly = polygons[i];
        poly.parent = null;
        poly.inner = null;
    }
    for (i = 0; i < polygons.length - 1; i++) {
        poly = polygons[i];
        for (let j = i + 1; j < polygons.length; j++) {
            let parent = polygons[j];
            if (opentop && parent.isOpen()) {
                continue;
            }
            if (poly.isNested(parent)) {
                parent.addInner(poly);
                break;
            }
        }
    }
    let tops = [],
        p;
    for (i = 0; i < polygons.length; i++) {
        p = polygons[i];
        poly = p;
        poly.depth = 0;
        while (p.parent) {
            poly.depth++;
            p = p.parent;
        }
        if (deep) {
            if (poly.depth === 0) tops.push(poly);
        } else {
            if (poly.depth % 2 === 0) {
                tops.push(poly);
            } else {
                poly.inner = null;
            }
        }
    }
    return tops;
}

function setWinding(array, CW, recurse) {
    if (!array) return;
    let poly, i = 0;
    while (i < array.length) {
        poly = array[i++];
        if (poly.isClockwise() !== CW) poly.reverse();
        if (recurse && poly.inner) setWinding(poly.inner, !CW, false);
    }
    return array;
}

function alignWindings(polys) {
    let len = polys.length,
        fwd = 0,
        pts = 0,
        i = 0,
        setCW,
        poly;
    while (i < len) {
        poly = polys[i++];
        pts += poly.length;
        if (poly.isClockwise()) fwd += poly.length;
    }
    i = 0;
    setCW = fwd > (pts/2);
    while (i < len) {
        poly = polys[i++];
        if (poly.isClockwise() != setCW) poly.reverse();
    }
    return setCW;
}

function setContains(setA, poly) {
    for (let i = 0; i < setA.length; i++) {
        if (setA[i].contains(poly)) return true;
    }
    return false;
}

function flatten(polys, to, crush) {
    to = to || [];
    for (let poly of polys) {
        poly.flattenTo(to);
        if (crush) poly.inner = null;
    }
    return to;
}

function subtract(setA, setB, outA, outB, z, minArea, opt = {}) {
    let min = numOrDefault(minArea, 0.1),
        out = [];

    function filterOut(from, to = []) {
        from.forEach(function(poly) {
            if (poly.area() >= min && poly.length > 2) {
                to.push(poly);
                out.push(poly);
            }
        });
        return to;
    }

    let clip = new Clipper(),
        tree = new PolyTree(),
        sp1 = toClipper(setA),
        sp2 = toClipper(setB);

    clip.StrictlySimple = true;
    if (outA) {
        clip.AddPaths(sp1, PathSubject, true);
        clip.AddPaths(sp2, PathClip, true);
        if (clip.Execute(ClipDiff, tree, FillEvenOdd, FillEvenOdd)) {
            cleanClipperTree(tree);
            pushAll(outA, filterOut(fromClipperTree(tree, z, null, null, min)));
        }
    }
    if (outB) {
        if (outA) {
            tree.Clear();
            clip.Clear();
        }
        clip.AddPaths(sp2, PathSubject, true);
        clip.AddPaths(sp1, PathClip, true);
        if (clip.Execute(ClipDiff, tree, FillEvenOdd, FillEvenOdd)) {
            cleanClipperTree(tree);
            pushAll(outB, filterOut(fromClipperTree(tree, z, null, null, min)));
        }
    }

    return out;
}

function union(polys, minarea, all, opt = {}) {
    if (polys.length < 2) return polys;
    let lpre = length(polys);

    let out = polys.slice(), i, j, u, uset = [];

    outer: for (i = 0; i < out.length; i++) {
        if (!out[i]) continue;
        for (j = i + 1; j < out.length; j++) {
            if (!out[j]) continue;
            u = out[i].union(out[j], minarea, all);
            if (u && u.length) {
                out[i] = null;
                out[j] = null;
                if (all) {
                    pushAll(out, u);
                } else {
                    out.push(u);
                }
                continue outer;
            }
        }
    }

    for (i = 0; i < out.length; i++) {
        if (out[i]) {
            if (!minarea || out[i].area() >= minarea) {
                uset.push(out[i]);
            }
        }
    }

    opt.changes = length(uset) - lpre;
    return uset;
}

function diff(setA, setB, z) {
    let clip = new Clipper(),
        tree = new PolyTree(),
        sp1 = toClipper(setA),
        sp2 = toClipper(setB);

    clip.AddPaths(sp1, PathSubject, true);
    clip.AddPaths(sp2, PathClip, true);

    if (clip.Execute(ClipDiff, tree, FillEvenOdd, FillEvenOdd)) {
        return fromClipperTree(tree, z);
    } else {
        return null;
    }
}

function xor(set, z) {
    z = z || set[0].getZ();
    outer: for (;;) {
        set.sort((a,b) => b.area() - a.area());
        for (let i = 0; i < set.length; i++) {
            let p0 = set[i];
            for (let j = i + 1; j < set.length; j++) {
                let p1 = set[j];
                if (p1.overlaps(p0) && p1.intersects(p0)) {
                    let xr = p0.xor(p1);
                    if (xr.length === 2) {
                        let same0 = Math.abs(p0.area() - xr[0].area()) + Math.abs(p1.area() - xr[1].area()) < 0.01;
                        let same1 = Math.abs(p1.area() - xr[0].area()) + Math.abs(p0.area() - xr[1].area()) < 0.01;
                        if (same0 || same1) {
                            continue;
                        }
                    }
                    set[i] = null;
                    set[j] = null;
                    set = set.filter(o => o);
                    pushAll(set, xr);
                    continue outer;
                }
            }
        }
        break;
    }
    return set;
}

function trimTo(setA, setB, opt = {}) {
    if (setA === setB || setA === null || setB === null) {
        return null;
    }

    let out = [], tmp;
    doCombinations(setA, setB, {}, (a, b) => {
        if (tmp = a.mask(b, opt.nullEq, opt.minArea)) {
            pushAll(out, tmp);
        }
    });

    return out;
}

/**
 * @param {Polygon[]} polys
 * @param {number} distance offset (positive = outset/grow)
 * @param {number} [z] defaults to 0
 * @param {Polygon[]} [out] optional collector
 * @param {number} [count] offset passes (0 == until no space left)
 * @param {number} [distance2] after first offset pass
 * @param {Function} [collector] receives output of each pass
 * @returns {Polygon[]} last offset
 */
function expand(polys, distance, z, out, count, distance2, collector, min) {
    return offset(polys, [distance, distance2 || distance], {
        z, outs: out, call: collector, minArea: min, count, flat: true
    });
}

/**
 * offset an array of polygons by distance with options to recurse
 * and return resulting gaps from offsets (uncleared areas in CAM mode)
 * PORT: wasm and open-poly (paths.js) branches not ported; open polys are
 * dropped from clipper offsetting exactly as in source.
 */
function offset(polys, dist, opts = {}) {
    // do not use clipper to offset open lines
    polys = polys.filter(p => !p.open);

    // cause inner / outer polys to be reversed from each other
    alignWindings(polys);
    for (let poly of polys) {
        if (poly.inner) {
            setWinding(poly.inner, !poly.isClockwise());
        }
    }

    let orig = polys,
        count = numOrDefault(opts.count, 1),
        depth = numOrDefault(opts.depth, 0),
        clean = opts.clean !== false,
        simple = opts.simple !== false,
        fill = numOrDefault(opts.fill, FillNonZero),
        join = numOrDefault(opts.join, JoinType.jtMiter),
        type = numOrDefault(opts.type, EndType.etClosedPolygon),
        offs = Array.isArray(dist) ? (dist.length > 1 ? dist.shift() : dist[0]) : dist,
        mina = numOrDefault(opts.minArea, 0.1),
        zed = opts.z || 0;

    let coff = new ClipperOffset(opts.miter, opts.arc),
        tree = new PolyTree();

    for (let poly of polys) {
        let clip = poly.toClipper();
        if (clean) clip = CleanPolygons(clip, opts.cleanDist ?? config.clipperClean);
        if (simple) clip = SimplifyPolygons(clip, fill);
        coff.AddPaths(clip, join, type);
    }
    coff.Execute(tree, (offs * config.clipper) | 0);
    polys = fromClipperTree(tree, zed, null, null, mina);

    // if specified, perform offset gap analysis
    if (opts.gaps && polys.length) {
        let oneg = offset(polys, -offs, {
            fill: opts.fill,
            join: opts.join,
            type: opts.type,
            z: opts.z,
            minArea: mina
        });
        let suba = [];
        subtract(orig, oneg, suba, null, zed);
        pushFlat(opts.gaps, suba, opts.flat);
    }

    // if offset fails, consider last polygons as gap areas
    if (opts.gaps && !polys.length) {
        pushFlat(opts.gaps, orig, opts.flat);
    }

    // if specified, perform up to *count* successive offsets
    if (polys.length) {
        opts.outs = opts.outs || [];
        pushFlat(opts.outs, polys, opts.flat);
        if (opts.call) {
            opts.call(polys, count, depth);
        }
        if (count > 1) {
            opts.count = count - 1;
            opts.depth = depth + 1;
            offset(polys, dist, opts);
        }
    }

    return opts.flat ? opts.outs : polys;
}

/**
 * progressive insetting with inset + outset deburring and gap analysis
 */
function inset(polys, dist, count, z, wasm) {
    let total = count;
    let layers = [];
    let ref = polys;
    let depth = 0;
    while (count-- > 0 && ref && ref.length) {
        let off = offset(ref, -dist, {z});
        let mid = offset(off, dist / 2, {z});
        let cmp = offset(off, dist, {z});
        let gap = [];
        let aref = ref.map(p => p.areaDeep()).reduce((a,p) => a + p);
        let cref = cmp.length ? cmp.map(p => p.areaDeep()).reduce((a,p) => a + p) : 0;
        if (Math.abs(aref - cref) > 1 - (Math.abs(aref / cref) / 1000)) {
            subtract(ref, cmp, gap, null, z);
        }
        layers.push({idx: total-count, off, mid, gap});
        for (let m of mid) {
            m.depth = depth++;
            if (m.inner) {
                for (let mi of m.inner) {
                    mi.depth = m.depth;
                }
            }
        }
        ref = off;
    }
    return layers;
}

function dedup(arr, same) {
    const out = [];
    let prev;
    for (const x of arr) {
        if (!prev || !same(prev, x)) out.push(x);
        prev = x;
    }
    return out;
}

/**
 * Given an array of Polygons, attempt to reconnect open polygons
 * into longer chains. If the chains close, emit a closed Polygon.
 */
function reconnect(polys, sameZ = true) {
    for (let p of polys) {
        if (p.appearsClosed()) {
            p.points.pop();
            p.setClosed();
        }
    }
    if (polys.length > 1) {
        let heal = 0;
        outer: for (; ; heal++) {
            let ntmp = polys, tlen = ntmp.length;
            for (let i = 0; i < tlen; i++) {
                let s1 = ntmp[i];
                if (!s1) continue;
                for (let j = i + 1; j < tlen; j++) {
                    let s2 = ntmp[j];
                    if (!s2) continue;
                    if (sameZ && Math.abs(s1.getZ() - s2.getZ()) > 0.01) {
                        continue;
                    }
                    if (!(s1.open && s2.open)) continue;
                    if (s1.last().isMergable2D(s2.first())) {
                        s1.addPoints(s2.points);
                        ntmp[j] = null;
                        continue outer;
                    }
                    if (s2.last().isMergable2D(s1.first())) {
                        s2.addPoints(s1.points);
                        ntmp[i] = null;
                        continue outer;
                    }
                    if (s1.first().isMergable2D(s2.first())) {
                        s1.reverse();
                        s1.addPoints(s2.points);
                        ntmp[j] = null;
                        continue outer;
                    }
                    if (s1.last().isMergable2D(s2.last())) {
                        s2.reverse();
                        s1.addPoints(s2.points);
                        ntmp[j] = null;
                        continue outer;
                    }
                }
            }
            break;
        }
        if (heal > 0) {
            polys = polys.filter(o => o);
        }
        for (let poly of polys) {
            poly.points = dedup(poly.points, (a,b) => a.isMergable3D(b));
            if (poly.open) {
                if (poly.first().isMergable3D(poly.last())) {
                    poly.points.pop();
                    poly.open = false;
                } else if (poly.first().isMergable2D(poly.last())) {
                    poly.open = false;
                }
            }
        }
    }
    return polys;
}

// plan a route through an array of polygon center points
// starting with the polygon center closest to "start"
function route(polys, start) {
    let centers = [];
    let first, minDist = Infinity;
    for (let poly of polys) {
        let center = poly.average();
        let rec = {poly, center, used: false};
        let dist = center.distTo2D(start);
        if (dist < minDist) {
            first = rec;
            minDist = dist;
        }
        centers.push(rec);
    }
    first.used = true;
    let routed = [ first ];
    for (;;) {
        let closest;
        let minDist = Infinity;
        for (let rec of centers) {
            if (!rec.used) {
                let dist = rec.center.distTo2D(first.center);
                if (dist < minDist) {
                    minDist = dist;
                    closest = rec;
                }
            }
        }
        if (!closest) {
            break;
        } else {
            closest.used = true;
            routed.push(first = closest);
        }
    }
    return routed.map(r => r.poly);
}

function print(polys, pad = '  ', buf) {
    buf = buf || [];
    for (let poly of polys) {
        buf.push(`${pad} - ${poly.points.length}`);
        if (poly.inner) print(poly.inner, pad + pad, buf);
    }
    return buf;
}

// ---- namespace export ----

return {
    // classes + factories
    Point, newPoint, pointFromClipper,
    Slope, newSlope, newSlopeFromAngle,
    Bounds, newBounds,
    Polygon, newPolygon, fromClipperPath,
    // shared state
    config, util, key, ClipperLib,
    // polygons namespace
    alignWindings,
    cleanClipperTree,
    clearInner,
    diff,
    expand,
    filter,
    flatten,
    fromClipperNode,
    fromClipperTree,
    fromClipperTreeUnion,
    inner,
    inset,
    length,
    nest,
    offset,
    outer,
    points,
    print,
    reconnect,
    renest,
    route,
    setContains,
    setWinding,
    setZ,
    subtract,
    toClipper,
    trimTo,
    union,
    verify,
    xor
};

})();
if(typeof module!=='undefined'&&module.exports){ module.exports={POLY}; }
