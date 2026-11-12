// Where a site monitor keeps its secret (docs/SCOPE.md D146, step 7h): its
// device keys (src/servercrypto.rs DeviceKeys) and the server credential it
// was given, as one small JSON text.
//
// - Linux: the Secret Service, through `secret-tool` (libsecret's own tool,
//   as the notifications go through gdbus, D250). Where there is none (a
//   bare Wayland session, no keyring daemon), a file readable only by this
//   user, and Settings says so.
// - macOS: the login keychain, through `security`.
// - Windows: the Credential Manager (CredWriteW / CredReadW / CredDeleteW,
//   declared by hand as thiscomputer.rs declares GetAdaptersAddresses).
//
// No crate: each of these is the system's own. TOPO_KEYSTORE_DIR set (the
// tests) uses the file only, so a test never touches the real keychain.

use std::fs;
use std::path::{Path, PathBuf};

pub const SERVICE: &str = "systems.carino.topo";
pub const ACCOUNT: &str = "site-monitor";

/// Where the secret went: "keychain" or "file".
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Keychain,
    File,
}

impl Kind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Kind::Keychain => "keychain",
            Kind::File => "file",
        }
    }
}

pub struct KeyStore {
    /// The fallback file's folder (`<app data>/monitor`).
    dir: PathBuf,
    /// Only the file (the tests).
    file_only: bool,
}

impl KeyStore {
    pub fn new(dir: PathBuf) -> KeyStore {
        match std::env::var("TOPO_KEYSTORE_DIR") {
            Ok(d) if !d.is_empty() => KeyStore { dir: PathBuf::from(d), file_only: true },
            _ => KeyStore { dir, file_only: false },
        }
    }

    #[cfg(test)]
    pub fn file_only(dir: PathBuf) -> KeyStore {
        KeyStore { dir, file_only: true }
    }

    fn file(&self) -> PathBuf {
        self.dir.join("monitor-key.json")
    }

    /// Keeps the secret: in the keychain when there is one, else the file.
    pub fn put(&self, secret: &str) -> Result<Kind, String> {
        if !self.file_only && os::put(secret).is_ok() {
            // An older fallback file must not outlive the move.
            let _ = fs::remove_file(self.file());
            return Ok(Kind::Keychain);
        }
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        private_dir(&self.dir);
        crate::client::write_private_atomic(&self.file(), secret.as_bytes())?;
        Ok(Kind::File)
    }

    /// The secret and where it was, or None.
    pub fn get(&self) -> Option<(String, Kind)> {
        if !self.file_only {
            if let Ok(Some(s)) = os::get() {
                return Some((s, Kind::Keychain));
            }
        }
        fs::read_to_string(self.file()).ok().filter(|s| !s.trim().is_empty()).map(|s| (s, Kind::File))
    }

    /// Forgets it everywhere.
    pub fn delete(&self) {
        if !self.file_only {
            let _ = os::delete();
        }
        let _ = fs::remove_file(self.file());
    }
}

#[cfg(unix)]
fn private_dir(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(p, fs::Permissions::from_mode(0o700));
}
#[cfg(not(unix))]
fn private_dir(_p: &Path) {}

#[cfg(all(unix, not(target_os = "macos")))]
mod os {
    use std::io::Write;
    use std::process::{Command, Stdio};

    fn tool() -> Command {
        let mut c = Command::new("secret-tool");
        c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        c
    }

    pub fn put(secret: &str) -> Result<(), String> {
        let mut child = tool()
            .args(["store", "--label=Topo site monitor", "service", super::SERVICE, "account", super::ACCOUNT])
            .spawn()
            .map_err(|e| e.to_string())?;
        // The secret goes on stdin, never on the command line.
        child.stdin.take().ok_or("stdin")?.write_all(secret.as_bytes()).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err("secret-tool".into());
        }
        // Read back: a Secret Service that took it but cannot give it back
        // (a locked collection no one can unlock) is no keychain.
        match get()? {
            Some(s) if s == secret => Ok(()),
            _ => Err("secret-tool".into()),
        }
    }

    pub fn get() -> Result<Option<String>, String> {
        let out = tool()
            .args(["lookup", "service", super::SERVICE, "account", super::ACCOUNT])
            .stdin(Stdio::null())
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Ok(None);
        }
        let s = String::from_utf8(out.stdout).map_err(|e| e.to_string())?;
        Ok(if s.trim().is_empty() { None } else { Some(s.trim_end_matches('\n').to_string()) })
    }

    pub fn delete() -> Result<(), String> {
        tool().args(["clear", "service", super::SERVICE, "account", super::ACCOUNT]).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod os {
    use std::process::Command;

    pub fn put(secret: &str) -> Result<(), String> {
        // -U updates one that is there. `security` takes the password as an
        // argument (it has no stdin form for -w); it is briefly visible to
        // this user's own processes only.
        let out = Command::new("security")
            .args(["add-generic-password", "-U", "-s", super::SERVICE, "-a", super::ACCOUNT, "-w", secret])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err("security".into())
        }
    }

    pub fn get() -> Result<Option<String>, String> {
        let out = Command::new("security")
            .args(["find-generic-password", "-s", super::SERVICE, "-a", super::ACCOUNT, "-w"])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Ok(None);
        }
        let s = String::from_utf8(out.stdout).map_err(|e| e.to_string())?;
        Ok(Some(s.trim_end_matches('\n').to_string()).filter(|s| !s.is_empty()))
    }

    pub fn delete() -> Result<(), String> {
        Command::new("security").args(["delete-generic-password", "-s", super::SERVICE, "-a", super::ACCOUNT]).output().map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(windows)]
mod os {
    // The Credential Manager, a generic credential for this user.
    use std::ffi::c_void;

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[repr(C)]
    struct Credential {
        flags: u32,
        kind: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    const CRED_TYPE_GENERIC: u32 = 1;
    const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;

    #[link(name = "advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const Credential, flags: u32) -> i32;
        fn CredReadW(target: *const u16, kind: u32, flags: u32, credential: *mut *mut Credential) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut c_void);
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn target() -> Vec<u16> {
        wide(&format!("{}/{}", super::SERVICE, super::ACCOUNT))
    }

    pub fn put(secret: &str) -> Result<(), String> {
        let mut t = target();
        let mut user = wide(super::ACCOUNT);
        let mut blob = secret.as_bytes().to_vec();
        let c = Credential {
            flags: 0,
            kind: CRED_TYPE_GENERIC,
            target_name: t.as_mut_ptr(),
            comment: std::ptr::null_mut(),
            last_written: FileTime { low: 0, high: 0 },
            blob_size: blob.len() as u32,
            blob: blob.as_mut_ptr(),
            persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: std::ptr::null_mut(),
            target_alias: std::ptr::null_mut(),
            user_name: user.as_mut_ptr(),
        };
        let ok = unsafe { CredWriteW(&c, 0) };
        if ok != 0 {
            Ok(())
        } else {
            Err("credwrite".into())
        }
    }

    pub fn get() -> Result<Option<String>, String> {
        let t = target();
        let mut p: *mut Credential = std::ptr::null_mut();
        let ok = unsafe { CredReadW(t.as_ptr(), CRED_TYPE_GENERIC, 0, &mut p) };
        if ok == 0 || p.is_null() {
            return Ok(None);
        }
        let s = unsafe {
            let c = &*p;
            let bytes = std::slice::from_raw_parts(c.blob, c.blob_size as usize).to_vec();
            CredFree(p as *mut c_void);
            bytes
        };
        Ok(String::from_utf8(s).ok())
    }

    pub fn delete() -> Result<(), String> {
        let t = target();
        unsafe { CredDeleteW(t.as_ptr(), CRED_TYPE_GENERIC, 0) };
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_fallback_is_private_and_forgets() {
        let dir = std::env::temp_dir().join(format!("topo-keystore-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let ks = KeyStore::file_only(dir.join("monitor"));
        assert!(ks.get().is_none());
        assert_eq!(ks.put("{\"v\":1}").unwrap(), Kind::File);
        assert_eq!(ks.get().unwrap(), ("{\"v\":1}".to_string(), Kind::File));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(ks.file()).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(dir.join("monitor")).unwrap().permissions().mode() & 0o777, 0o700);
        }
        ks.delete();
        assert!(ks.get().is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
