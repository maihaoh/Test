"""Source-derived Choice baccarat result decoder (OFFLINE component).

No network access, login, token collection, betting, or dashboard writes.
Input must be a COMPLETE PLAINTEXT application packet, AFTER any transport
wrapping, decompression and decryption. This is NOT an end-to-end API client.

Recovered from choice-result-protocol-report(1).json, dated 2026-09-29.
See FINDINGS.md for exact source locations, known omissions and test scope.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import json
import re
import struct
import sys
from pathlib import Path
from typing import Any, Iterable

BAC_FULL_RESULT_LIST = 135176
GAME_SNAPSHOT_PROTO = 135190
SUBSCRIBE_VIDEO_LIST = 77829
HEADER_SIZE = 12
MAX_PACKET_SIZE = 8 * 1024 * 1024
MAX_VALUES = 100_000
DEFAULT_VIDS = tuple(f"D0{n}" for n in range(51, 59))


class DecodeError(ValueError):
    """Invalid, incomplete, incompatible or unsupported input; do not publish it."""


class _Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def remaining(self) -> int:
        return len(self.data) - self.pos

    def take(self, count: int) -> bytes:
        if count < 0 or count > self.remaining():
            raise DecodeError(f"Truncated protobuf field at byte {self.pos}")
        start = self.pos
        self.pos += count
        return self.data[start:self.pos]

    def varint(self) -> int:
        value = 0
        for shift in range(0, 70, 7):
            if not self.remaining():
                raise DecodeError("Truncated protobuf varint")
            byte = self.data[self.pos]
            self.pos += 1
            if shift == 63 and byte > 1:
                raise DecodeError("Protobuf varint exceeds 64 bits")
            value |= (byte & 127) << shift
            if not byte & 128:
                return value
        raise DecodeError("Invalid protobuf varint")

    def u32(self) -> int:
        value = self.varint()
        if value > 0xFFFFFFFF:
            raise DecodeError("uint32 value out of range")
        return value

    def i32(self) -> int:
        value = self.varint() & 0xFFFFFFFF
        return value - 0x100000000 if value & 0x80000000 else value

    def block(self) -> bytes:
        return self.take(self.u32())

    def text(self) -> str:
        try:
            return self.block().decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise DecodeError("Invalid UTF-8 string") from exc

    def tag(self) -> tuple[int, int]:
        tag = self.u32()
        number, wire = tag >> 3, tag & 7
        if number == 0 or wire > 5:
            raise DecodeError("Invalid protobuf tag")
        return number, wire

    def skip(self, wire: int, number: int, depth: int = 0) -> None:
        if wire == 0:
            self.varint()
        elif wire == 1:
            self.take(8)
        elif wire == 2:
            self.block()
        elif wire == 3:
            if depth >= 16:
                raise DecodeError("Protobuf group nesting limit")
            while self.remaining():
                child, child_wire = self.tag()
                if child_wire == 4:
                    if child != number:
                        raise DecodeError("Mismatched protobuf end-group")
                    return
                self.skip(child_wire, child, depth + 1)
            raise DecodeError("Unclosed protobuf group")
        elif wire == 5:
            self.take(4)
        else:
            raise DecodeError("Unexpected protobuf end-group")


def _wire(actual: int, expected: int, number: int) -> None:
    if actual != expected:
        raise DecodeError(f"Field {number}: expected wire type {expected}, got {actual}")


def _repeated(reader: _Reader, wire: int, values: list[int], signed: bool) -> None:
    if wire not in (0, 2):
        raise DecodeError("Repeated numeric field must use varint or packed encoding")
    source = _Reader(reader.block()) if wire == 2 else reader
    read = source.i32 if signed else source.u32
    if wire == 0:
        if len(values) >= MAX_VALUES:
            raise DecodeError("Too many repeated values")
        values.append(read())
    else:
        while source.remaining():
            if len(values) >= MAX_VALUES:
                raise DecodeError("Too many repeated values")
            values.append(read())


def _multi_rou(data: bytes) -> dict[str, int]:
    reader = _Reader(data)
    out = {"number": 0, "multiplier": 0}
    while reader.remaining():
        number, wire = reader.tag()
        if number in (1, 2):
            _wire(wire, 0, number)
            out["number" if number == 1 else "multiplier"] = reader.i32()
        else:
            reader.skip(wire, number)
    return out


def decode_full_result_payload(data: bytes) -> dict[str, Any]:
    """Decode the verified FullResultList fields; retain CardList bytes opaquely.

    Source fields 1..9 are known. CardList's INNER field numbers are not in
    the supplied report, so field 7 is retained as dealercardlists_raw_hex,
    not incorrectly claimed to be fully decoded.
    """
    if not isinstance(data, bytes):
        raise TypeError("data must be bytes")
    if len(data) > MAX_PACKET_SIZE:
        raise DecodeError("Payload exceeds configured size limit")
    reader = _Reader(data)
    out: dict[str, Any] = {
        "vid": "", "seqno": 0, "gmtype": "", "version": 0,
        "wininfo": [], "extrainfo": [], "dealercardlists_raw_hex": [],
        "mrouresult": [], "goodroad": 0, "present_fields": [],
        "unknown_fields": [],
    }
    present: set[int] = set()
    field_count = 0
    while reader.remaining():
        field_count += 1
        if field_count > MAX_VALUES:
            raise DecodeError("Too many protobuf fields")
        start = reader.pos
        number, wire = reader.tag()
        present.add(number)
        if number in (1, 4):
            _wire(wire, 2, number)
            out["vid" if number == 1 else "gmtype"] = reader.text()
        elif number in (2, 6):
            _wire(wire, 0, number)
            out["seqno" if number == 2 else "version"] = reader.i32()
        elif number in (3, 5):
            _repeated(reader, wire, out["wininfo" if number == 3 else "extrainfo"], number == 3)
        elif number == 7:
            _wire(wire, 2, number)
            out["dealercardlists_raw_hex"].append(reader.block().hex())
        elif number == 8:
            _wire(wire, 2, number)
            out["mrouresult"].append(_multi_rou(reader.block()))
        elif number == 9:
            _wire(wire, 0, number)
            out["goodroad"] = reader.u32()
        else:
            reader.skip(wire, number)
            out["unknown_fields"].append({
                "field": number, "wire_type": wire,
                "encoded_hex": data[start:reader.pos].hex(),
            })
    out["present_fields"] = sorted(present)
    return out


def decode_wininfo(value: int) -> dict[str, Any]:
    """Translate one baccarat wininfo integer using the supplied roadmap code.

    The low byte is a BITMASK, not the frontend WinType enum: tie = 0x04,
    while frontend WinType.TIE = 3. Preserve the source's red/blue/tie
    priority, but flag impossible/ambiguous values rather than publishing
    an unqualified result. Upper bits have no inferred business meaning.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        raise DecodeError("wininfo entry is not an integer")
    if not 0 <= value <= 0x7FFFFFFF:
        raise DecodeError("Negative/out-of-range wininfo: baccarat bit mapping not verified")
    flags = value & 255
    points = (value >> 8) & 255
    win_type = 1 if flags & 1 else 2 if flags & 2 else 3 if flags & 4 else 0
    outcome_flags = flags & 7
    issues = []
    if outcome_flags not in (1, 2, 4):
        issues.append("missing_or_multiple_outcome_bits")
    if points > 9:
        issues.append("points_outside_baccarat_range")
    names = {0: "NONE", 1: "RED_WIN", 2: "BLUE_WIN", 3: "TIE"}
    labels = {1: "B", 2: "P", 3: "T"}
    return {
        "raw_wininfo": value,
        "raw_hex": f"0x{value:08X}",
        "flags": flags,
        "upper16_uninterpreted": value >> 16,
        "winType": win_type,
        "winName": names[win_type],
        "winNum": points,
        "redPair": bool(flags & 8),
        "bluePair": bool(flags & 16),
        "bankerPair": bool(flags & 8),
        "playerPair": bool(flags & 16),
        "result": labels.get(win_type) if not issues else None,
        "issues": issues,
    }


def decode_result_packet(packet: bytes, allowed_vids: Iterable[str] = DEFAULT_VIDS) -> dict[str, Any]:
    """Decode one unwrapped, decompressed, decrypted result packet only.

    This does not identify a server endpoint or authenticate a session.
    No packet is treated as a result merely because it contains 'D051'.
    """
    if not isinstance(packet, bytes):
        raise TypeError("packet must be bytes")
    if len(packet) < HEADER_SIZE:
        raise DecodeError("Packet header is incomplete")
    resp_id, declared, seq = struct.unpack_from(">III", packet)
    if declared < HEADER_SIZE or declared > MAX_PACKET_SIZE:
        raise DecodeError("Invalid declared packet length")
    if len(packet) != declared:
        raise DecodeError(f"Expected {declared} bytes; received {len(packet)}")
    if resp_id != BAC_FULL_RESULT_LIST:
        raise DecodeError(f"Not BAC_FULL_RESULT_LIST: respId=0x{resp_id:08X}")
    if len(packet) < 16:
        raise DecodeError("Result packet is missing its four-byte vid")
    try:
        outer_vid = packet[12:16].decode("ascii", errors="strict")
    except UnicodeDecodeError as exc:
        raise DecodeError("Invalid outer vid") from exc
    if outer_vid not in set(allowed_vids):
        raise DecodeError(f"Outside explicitly allowed baccarat tables: {outer_vid!r}")
    payload = decode_full_result_payload(packet[16:])
    if payload["vid"] and payload["vid"] != outer_vid:
        raise DecodeError("Outer vid and protobuf vid disagree; refuse table attribution")
    results = []
    for index, value in enumerate(payload["wininfo"]):
        try:
            row = decode_wininfo(value)
        except DecodeError as exc:
            row = {"raw_wininfo": value, "result": None, "issues": [str(exc)]}
        results.append({"list_index": index, **row})
    return {
        "kind": "baccarat_result_list_snapshot",
        "scope": "offline_plaintext_decoder_not_live_api",
        "resp_id": resp_id, "resp_id_hex": f"0x{resp_id:08X}",
        "packet_length": declared, "header_seq_no": seq,
        "vid": outer_vid, "payload": payload, "results": results,
        "result_count": len(results),
        "has_invalid_rows": any(row["issues"] for row in results),
        "notes": [
            "This is a replacement list snapshot, not an instruction to append every row.",
            "list_index is NOT a verified round ID; FullResultList has no per-row gmcode here.",
            "Do not add tieNum as extra rounds: standalone TIE rows are already results.",
            "Fields seqno/version and upper wininfo bits retain their names, not guessed semantics.",
        ],
    }


class PacketAssembler:
    """Application framing, one instance per connection; reset on reconnection.

    Use only on the appropriate unwrapped application byte stream. This is
    NOT a WebSocket frame parser and does NOT perform decompression/decryption.
    """
    def __init__(self) -> None:
        self._buffer = bytearray()

    @property
    def pending_bytes(self) -> int:
        return len(self._buffer)

    def reset(self) -> None:
        self._buffer.clear()

    def feed(self, data: bytes) -> list[bytes]:
        if not isinstance(data, bytes):
            raise TypeError("data must be bytes")
        if len(data) + len(self._buffer) > MAX_PACKET_SIZE * 2:
            self.reset()
            raise DecodeError("Framing buffer limit exceeded")
        self._buffer.extend(data)
        out = []
        consumed = 0
        try:
            while len(self._buffer) - consumed >= HEADER_SIZE:
                length = struct.unpack_from(">I", self._buffer, consumed + 4)[0]
                if not HEADER_SIZE <= length <= MAX_PACKET_SIZE:
                    raise DecodeError("Unrecognized framing; not attempting heuristic resynchronization")
                if len(self._buffer) - consumed < length:
                    break
                out.append(bytes(self._buffer[consumed:consumed + length]))
                consumed += length
        except DecodeError:
            self.reset()
            raise
        del self._buffer[:consumed]
        return out

    def finish(self) -> None:
        if self._buffer:
            raise DecodeError(f"Incomplete final packet: {len(self._buffer)} bytes remain")


def build_subscribe_packet(vids: Iterable[str], seq_no: int = 0) -> bytes:
    """Build the source-derived command; DOES NOT SEND IT OR CONFIRM ACCESS.

    The source sends this after successful game login. Permissions and
    actual server acknowledgements still must be checked by a future client.
    """
    vids = list(vids)
    if len(vids) > 1000 or len(set(vids)) != len(vids):
        raise ValueError("Invalid vid count or duplicate vids")
    if isinstance(seq_no, bool) or not isinstance(seq_no, int) or not 0 <= seq_no <= 0xFFFFFFFF:
        raise ValueError("seq_no must be a uint32")
    if any(not isinstance(v, str) or not re.fullmatch(r"[A-Za-z0-9]{4}", v) for v in vids):
        raise ValueError("Each vid must be exactly four ASCII letters/digits")
    payload = struct.pack(">I", len(vids)) + b"".join(v.encode("ascii") for v in vids)
    return struct.pack(">III", SUBSCRIBE_VIDEO_LIST, HEADER_SIZE + len(payload), seq_no) + payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--hex", dest="hex_data", help="One complete plaintext result packet as hex")
    inputs.add_argument("--base64", dest="base64_data", help="One complete plaintext result packet as base64")
    inputs.add_argument("--packet-file", type=Path, help="Binary file containing one complete plaintext packet")
    inputs.add_argument("--wininfo", nargs="+", type=lambda x: int(x, 0), help="Already-decoded baccarat wininfo integers; decimal or 0x...")
    inputs.add_argument("--subscription-hex", action="store_true", help="Print D051-D058 subscription bytes without sending them")
    parser.add_argument("--output", type=Path, help="Write a NEW offline result JSON; refuses to overwrite")
    args = parser.parse_args()
    try:
        if args.subscription_hex:
            obj: Any = {
                "hex": build_subscribe_packet(DEFAULT_VIDS).hex(),
                "sent": False,
                "note": "No connection or server acceptance test performed",
            }
        elif args.wininfo is not None:
            obj = {"scope": "offline_wininfo_only", "results": [decode_wininfo(v) for v in args.wininfo]}
        else:
            if args.hex_data is not None:
                packet = bytes.fromhex(args.hex_data)
            elif args.base64_data is not None:
                packet = base64.b64decode(args.base64_data, validate=True)
            else:
                if args.packet_file.stat().st_size > MAX_PACKET_SIZE:
                    raise DecodeError("Input file too large")
                packet = args.packet_file.read_bytes()
            obj = decode_result_packet(packet)
        text = json.dumps(obj, ensure_ascii=True, indent=2)
        if args.output:
            if args.output.name.lower() == "data.json":
                raise ValueError("Refusing to write dashboard data.json during offline analysis")
            with args.output.open("x", encoding="utf-8") as handle:
                handle.write(text + "\n")
            print(f"Offline output written: {args.output}")
        else:
            print(text)
        return 0
    except (ValueError, TypeError, OSError, binascii.Error) as exc:
        print(f"Not decoded: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
