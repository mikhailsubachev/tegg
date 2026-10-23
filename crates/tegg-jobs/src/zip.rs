//! A minimal ZIP writer for backups (§6, D-57): stored entries (no compression), UTF-8 names (flag bit 11), so the
//! files can be restored with any unzip tool, `ditto` included. No dependencies.

use std::io::{self, Write};

fn crc32(data: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let t = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (i, e) in t.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 {
                    0xEDB8_8320 ^ (c >> 1)
                } else {
                    c >> 1
                };
            }
            *e = c;
        }
        t
    });
    let mut c = 0xFFFF_FFFFu32;
    for b in data {
        c = t[((c ^ *b as u32) & 0xFF) as usize] ^ (c >> 8);
    }
    c ^ 0xFFFF_FFFF
}

/// Writes `entries` (name, bytes) as a stored ZIP into `out`. Sizes over 4 GiB are refused.
pub fn write_zip(out: &mut impl Write, entries: &[(String, Vec<u8>)]) -> io::Result<()> {
    let mut central = Vec::new();
    let mut offset: u64 = 0;
    let big = |n: u64| {
        if n > u32::MAX as u64 {
            Err(io::Error::other("backup larger than 4 GiB"))
        } else {
            Ok(n as u32)
        }
    };
    for (name, data) in entries {
        let crc = crc32(data);
        let size = big(data.len() as u64)?;
        let n = name.as_bytes();
        let mut local = Vec::with_capacity(30 + n.len());
        local.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        local.extend_from_slice(&20u16.to_le_bytes()); // version needed
        local.extend_from_slice(&0x0800u16.to_le_bytes()); // UTF-8 names
        local.extend_from_slice(&0u16.to_le_bytes()); // stored
        local.extend_from_slice(&[0, 0, 0x21, 0]); // time 00:00, date 1980-01-01
        local.extend_from_slice(&crc.to_le_bytes());
        local.extend_from_slice(&size.to_le_bytes());
        local.extend_from_slice(&size.to_le_bytes());
        local.extend_from_slice(&(n.len() as u16).to_le_bytes());
        local.extend_from_slice(&0u16.to_le_bytes());
        local.extend_from_slice(n);
        out.write_all(&local)?;
        out.write_all(data)?;

        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes()); // made by
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&0x0800u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&[0, 0, 0x21, 0]);
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&(n.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0; 8]); // extra, comment, disk, internal attributes
        central.extend_from_slice(&0u32.to_le_bytes()); // external attributes
        central.extend_from_slice(&big(offset)?.to_le_bytes());
        central.extend_from_slice(n);
        offset += local.len() as u64 + data.len() as u64;
    }
    let count = u16::try_from(entries.len())
        .map_err(|_| io::Error::other("more than 65,535 files in one backup"))?;
    out.write_all(&central)?;
    let mut end = Vec::with_capacity(22);
    end.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    end.extend_from_slice(&[0; 4]);
    end.extend_from_slice(&count.to_le_bytes());
    end.extend_from_slice(&count.to_le_bytes());
    end.extend_from_slice(&big(central.len() as u64)?.to_le_bytes());
    end.extend_from_slice(&big(offset)?.to_le_bytes());
    end.extend_from_slice(&0u16.to_le_bytes());
    out.write_all(&end)
}

/// Reads the entries of a stored ZIP (the format `write_zip` writes; ms4-tags §5.3 restore). Compressed entries,
/// or anything else it can't read, are an error: a backup is never restored half-understood.
pub fn read_zip(data: &[u8]) -> io::Result<Vec<(String, Vec<u8>)>> {
    let bad = || io::Error::other("not a Tegg backup zip");
    let u16_at = |i: usize| data.get(i..i + 2).map(|b| u16::from_le_bytes([b[0], b[1]]));
    let u32_at = |i: usize| data.get(i..i + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
    let eocd = (0..data.len().saturating_sub(21)).rev().find(|&i| u32_at(i) == Some(0x0605_4b50)).ok_or_else(bad)?;
    let count = u16_at(eocd + 10).ok_or_else(bad)? as usize;
    let mut at = u32_at(eocd + 16).ok_or_else(bad)? as usize;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        if u32_at(at) != Some(0x0201_4b50) || u16_at(at + 10) != Some(0) {
            return Err(bad());
        }
        let size = u32_at(at + 20).ok_or_else(bad)? as usize;
        let n = u16_at(at + 28).ok_or_else(bad)? as usize;
        let extra = u16_at(at + 30).ok_or_else(bad)? as usize;
        let comment = u16_at(at + 32).ok_or_else(bad)? as usize;
        let local = u32_at(at + 42).ok_or_else(bad)? as usize;
        let name = std::str::from_utf8(data.get(at + 46..at + 46 + n).ok_or_else(bad)?).map_err(|_| bad())?.to_string();
        let ln = u16_at(local + 26).ok_or_else(bad)? as usize;
        let le = u16_at(local + 28).ok_or_else(bad)? as usize;
        let start = local + 30 + ln + le;
        out.push((name, data.get(start..start + size).ok_or_else(bad)?.to_vec()));
        at += 46 + n + extra + comment;
    }
    Ok(out)
}

/// SHA-256 (FIPS 180-4) as lower-case hex: the hashes of the backup manifest (ms4-tags §5.1).
pub fn sha256_hex(bytes: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
        0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
        0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
        0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut msg = bytes.to_vec();
    let bits = (bytes.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn sha256_check_value() {
        assert_eq!(super::sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
    #[test]
    fn read_back_what_was_written() {
        let e = vec![("a/č.md".to_string(), b"x".to_vec()), ("b".to_string(), Vec::new())];
        let mut z = Vec::new();
        super::write_zip(&mut z, &e).unwrap();
        assert_eq!(super::read_zip(&z).unwrap(), e);
    }

    #[test]
    fn crc32_check_value() {
        assert_eq!(super::crc32(b"123456789"), 0xCBF4_3926);
    }
}
