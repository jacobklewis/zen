use std::fs;
use std::io::Read;
use std::path::Path;

const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;

/// Canonical paths keep parent traversal and symlinks within the document folder.
fn read_document_image(image_path: &Path, document_path: &Path) -> Result<Vec<u8>, String> {
    let document = fs::canonicalize(document_path).map_err(|e| e.to_string())?;
    let extension = document
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !document.is_file() || !matches!(extension.as_str(), "md" | "markdown" | "mdx") {
        return Err("A saved Markdown document is required to embed local images".into());
    }
    let directory = document.parent().ok_or("Invalid document folder")?;
    let image = fs::canonicalize(image_path).map_err(|e| e.to_string())?;
    if !image.starts_with(directory) {
        return Err("Local images must be inside the Markdown document's folder".into());
    }
    let extension = image
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !image.is_file()
        || !matches!(
            extension.as_str(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "bmp" | "ico"
        )
    {
        return Err("Unsupported image format".into());
    }
    let file = fs::File::open(image).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("Image exceeds the 32 MB export limit".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn read_export_image(
    image_path: String,
    document_path: String,
) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_document_image(Path::new(&image_path), Path::new(&document_path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root =
                std::env::temp_dir().join(format!("zen-html-{}-{unique}", std::process::id()));
            fs::create_dir_all(root.join("document/images")).unwrap();
            fs::write(root.join("document/guide.md"), "# Guide").unwrap();
            Self(root)
        }
        fn read(&self, image: &str) -> Result<Vec<u8>, String> {
            read_document_image(&self.0.join(image), &self.0.join("document/guide.md"))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn embeds_images_from_nested_document_folders() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("document/images/photo.png"), b"image bytes").unwrap();
        assert_eq!(
            fixture.read("document/images/photo.png").unwrap(),
            b"image bytes"
        );
    }

    #[test]
    fn rejects_outside_files_and_non_image_files() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("outside.png"), b"outside").unwrap();
        fs::write(fixture.0.join("document/notes.txt"), b"notes").unwrap();
        assert!(fixture.read("outside.png").unwrap_err().contains("inside"));
        assert!(fixture
            .read("document/../outside.png")
            .unwrap_err()
            .contains("inside"));
        assert!(fixture
            .read("document/notes.txt")
            .unwrap_err()
            .contains("Unsupported"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_escape_the_document_folder() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("outside.png"), b"outside").unwrap();
        std::os::unix::fs::symlink(
            fixture.0.join("outside.png"),
            fixture.0.join("document/link.png"),
        )
        .unwrap();
        assert!(fixture
            .read("document/link.png")
            .unwrap_err()
            .contains("inside"));
    }

    #[test]
    fn rejects_oversized_images() {
        let fixture = Fixture::new();
        let image = fs::File::create(fixture.0.join("document/large.png")).unwrap();
        image.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(fixture
            .read("document/large.png")
            .unwrap_err()
            .contains("32 MB"));
    }
}
