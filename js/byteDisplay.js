// byteDisplay.js — GPT-2 계열 byte-level 토큰의 안전한 화면 표시

// byte-level BPE는 UTF-8 바이트를 인쇄 가능한 유니코드로 매핑한다.
// 역매핑 후 토큰 시퀀스 전체를 스트리밍 디코드해야 분할된 멀티바이트 문자가 깨지지 않는다.
let byteDecoder = null;
function getByteDecoder() {
    if (byteDecoder) return byteDecoder;
    const bytes = [];
    for (let i = 33; i <= 126; i++) bytes.push(i);
    for (let i = 161; i <= 172; i++) bytes.push(i);
    for (let i = 174; i <= 255; i++) bytes.push(i);
    const codePoints = bytes.slice();
    let offset = 0;
    for (let byte = 0; byte < 256; byte++) {
        if (!bytes.includes(byte)) {
            bytes.push(byte);
            codePoints.push(256 + offset);
            offset += 1;
        }
    }
    byteDecoder = {};
    for (let i = 0; i < bytes.length; i++) {
        byteDecoder[String.fromCharCode(codePoints[i])] = bytes[i];
    }
    return byteDecoder;
}

const utf8Encoder = new TextEncoder();

export function byteLevelBytes(value) {
    const decoder = getByteDecoder();
    const bytes = [];
    for (const char of String(value)) {
        if (decoder[char] !== undefined) {
            bytes.push(decoder[char]);
        } else {
            bytes.push(...utf8Encoder.encode(char));
        }
    }
    return new Uint8Array(bytes);
}

export function byteLevelToText(value) {
    return new TextDecoder('utf-8', { fatal: false }).decode(byteLevelBytes(value));
}

export function visibleWhitespace(value, tokenMarkers = true) {
    let visible = String(value);
    if (tokenMarkers) {
        visible = visible.replace(/Ġ/g, '␣').replace(/Ċ/g, '⏎').replace(/▁/g, '␣');
    }
    return visible
        .replace(/ /g, '␣')
        .replace(/\n/g, '⏎')
        .replace(/\t/g, '⇥');
}

export function displaySurface(raw, byteLevel) {
    const value = byteLevel ? byteLevelToText(raw) : String(raw);
    return visibleWhitespace(value, !byteLevel);
}

export function displaySurfaces(rawTokens, byteLevel) {
    if (!byteLevel) return rawTokens.map((raw) => displaySurface(raw, false));

    const decoder = new TextDecoder('utf-8', { fatal: false });
    const surfaces = rawTokens.map((raw) =>
        decoder.decode(byteLevelBytes(raw), { stream: true })
    );
    const tail = decoder.decode();
    if (tail && surfaces.length) surfaces[surfaces.length - 1] += tail;
    return surfaces.map((value) => visibleWhitespace(value, false));
}

export function labelByteContinuations(rawTokens, surfaces, byteLevel) {
    if (!byteLevel) return surfaces.slice();
    return surfaces.map((surface, index) => {
        if (surface !== '') return surface;
        const bytes = Array.from(byteLevelBytes(rawTokens[index]));
        if (!bytes.length) return '';
        const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        return `[${hex}]`;
    });
}
