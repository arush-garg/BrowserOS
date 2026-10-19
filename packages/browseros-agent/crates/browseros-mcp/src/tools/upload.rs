use crate::framework::{
    ToolCtx, ToolExecResult, ToolResult, error_result, parse_args, pending_dialog_result,
    text_result,
};
use browseros_core::{PageId, Ref};
use futures_util::future::BoxFuture;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::Path;

const DESCRIPTION: &str = "\
Set local file path(s) on a file input using a ref from the last snapshot. \
This selects files in the page; it does not verify a network upload or publication. \
Use for <input type=\"file\"> upload flows; files must exist on the server filesystem.";

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct UploadArgs {
    /// Page id from `tabs`.
    page: u32,
    /// Ref of the <input type="file"> element, e.g. "e12".
    r#ref: String,
    /// Single local file path to upload.
    file: Option<String>,
    /// Local file paths to upload.
    files: Option<Vec<String>>,
}

pub fn definition() -> crate::framework::ToolDef {
    super::def::<UploadArgs>("upload", DESCRIPTION, None, handler)
}

fn validate_files(files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Err("upload: provide file or files[].".to_string());
    }
    for file in files {
        let path = Path::new(file);
        if !path.is_absolute() {
            return Err(format!("upload: file path must be absolute: {file}"));
        }
        let metadata = path
            .metadata()
            .map_err(|e| format!("upload: cannot access {file}: {e}"))?;
        if !metadata.is_file() {
            return Err(format!("upload: not a regular file: {file}"));
        }
    }
    Ok(())
}

fn upload_error(error: &str) -> String {
    if error.contains("Node is not a file input element") {
        return "upload: ref does not identify an <input type=\"file\">. Take a fresh snapshot and select the file input, not its button or drop zone.".to_string();
    }
    if error.contains("Unknown ref") || error.contains("StaleRef") {
        return format!("upload: {error}. Take a fresh snapshot of the same page before retrying.");
    }
    format!("upload failed: {error}")
}

fn handler<'a>(
    raw: Value,
    ctx: &'a ToolCtx,
    _response: &'a mut crate::response::ToolResponse,
) -> BoxFuture<'a, ToolExecResult<Option<ToolResult>>> {
    Box::pin(async move {
        let args: UploadArgs = parse_args(raw)?;
        if let Some(result) = pending_dialog_result(ctx, PageId(args.page)) {
            return Ok(Some(result));
        }
        let files = args
            .files
            .unwrap_or_else(|| args.file.clone().into_iter().collect::<Vec<_>>());
        if let Err(message) = validate_files(&files) {
            return Ok(Some(error_result(message)));
        }
        if let Err(error) = ctx
            .session
            .input(PageId(args.page))
            .await
            .upload_file_by_ref(&Ref(args.r#ref.clone()), files.clone())
            .await
        {
            return Ok(Some(error_result(upload_error(&error.to_string()))));
        }
        Ok(Some(text_result(
            format!(
                "Selected {} file(s) on {}. Verify the page and remote result before claiming an upload.",
                files.len(),
                args.r#ref
            ),
            Some(json!({
                "page": args.page,
                "ref": args.r#ref,
                "files": files,
                "selected": files.len(),
                "status": "file_selected"
            })),
        )))
    })
}

#[cfg(test)]
mod tests {
    use super::{upload_error, validate_files};

    #[test]
    fn rejects_missing_and_non_file_inputs_before_browser_action() {
        assert!(validate_files(&[]).is_err());
        assert!(validate_files(&["relative.mp4".to_string()]).is_err());
        assert!(validate_files(&["/path/that/does/not/exist.mp4".to_string()]).is_err());
        assert!(validate_files(&[std::env::temp_dir().display().to_string()]).is_err());
        assert!(validate_files(&[file!().to_string()]).is_err());
        let existing = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("Cargo.toml")
            .display()
            .to_string();
        assert!(validate_files(&[existing]).is_ok());
    }

    #[test]
    fn explains_wrong_node_and_stale_ref_without_retrying_mutation() {
        assert!(upload_error("CDP error: Node is not a file input element").contains("drop zone"));
        assert!(upload_error("Unknown ref e12").contains("fresh snapshot"));
    }
}
