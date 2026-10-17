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

#[cfg(test)]
mod tests {
    #[test]
    fn crc32_check_value() {
        assert_eq!(super::crc32(b"123456789"), 0xCBF4_3926);
    }
}
