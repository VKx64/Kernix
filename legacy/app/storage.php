<?php
/**
 * Storage abstraction. Currently only 'local' is implemented.
 *
 * When you're ready for S3, the system_settings table already has the columns.
 * Implementation will be added then (requires AWS SDK upload via cPanel File Manager).
 */

class Storage
{
    private static function driver(): string
    {
        $s = settings();
        return $s['storage_driver'] ?? 'local';
    }

    /**
     * Store an uploaded file ($_FILES[...] entry).
     */
    public static function putUpload(array $file, string $subdir = ''): array
    {
        if (!isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
            throw new RuntimeException('Invalid upload.');
        }
        if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
            throw new RuntimeException('Upload error code: ' . $file['error']);
        }
        if ($file['size'] > UPLOAD_MAX_BYTES) {
            throw new RuntimeException('File exceeds maximum upload size.');
        }

        $mime = self::detectMime($file['tmp_name'], $file['name']);
        if (!in_array($mime, UPLOAD_ALLOWED_MIME, true)) {
            throw new RuntimeException('File type not allowed: ' . $mime);
        }

        $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
        $safeName = self::randomName($ext);
        $rel = trim($subdir, '/') . '/' . date('Y/m') . '/' . $safeName;
        $rel = ltrim($rel, '/');

        $driver = self::driver();
        if ($driver === 's3') {
            throw new RuntimeException('S3 storage is not yet enabled. Switch back to local in Settings.');
        }
        self::localPutFile($file['tmp_name'], $rel);

        return [
            'driver'        => $driver,
            'path'          => $rel,
            'file_name'     => $safeName,
            'original_name' => $file['name'],
            'mime_type'     => $mime,
            'file_size'     => (int)$file['size'],
        ];
    }

    public static function url(string $driver, string $relativePath): string
    {
        if ($driver === 's3') {
            $s = settings();
            $base = rtrim($s['s3_public_url_base'] ?? '', '/');
            return $base . '/' . ltrim($relativePath, '/');
        }
        return APP_BASE . '/uploads/' . ltrim($relativePath, '/');
    }

    public static function delete(string $driver, string $relativePath): bool
    {
        if ($driver === 's3') return false;
        $abs = UPLOAD_PATH . '/' . $relativePath;
        if (file_exists($abs)) return unlink($abs);
        return true;
    }

    private static function localPutFile(string $tmpPath, string $relativePath): void
    {
        $abs = UPLOAD_PATH . '/' . $relativePath;
        $dir = dirname($abs);
        if (!is_dir($dir)) {
            if (!mkdir($dir, 0775, true) && !is_dir($dir)) {
                throw new RuntimeException('Failed to create upload directory.');
            }
        }
        if (!move_uploaded_file($tmpPath, $abs)) {
            throw new RuntimeException('Failed to move uploaded file.');
        }
        @chmod($abs, 0644);
    }

    private static function detectMime(string $path, string $originalName): string
    {
        if (function_exists('finfo_open')) {
            $f = finfo_open(FILEINFO_MIME_TYPE);
            $mime = finfo_file($f, $path);
            finfo_close($f);
            if ($mime) return $mime;
        }
        $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        $map = [
            'jpg'=>'image/jpeg','jpeg'=>'image/jpeg','png'=>'image/png','gif'=>'image/gif',
            'webp'=>'image/webp','svg'=>'image/svg+xml','pdf'=>'application/pdf',
            'doc'=>'application/msword','docx'=>'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls'=>'application/vnd.ms-excel','xlsx'=>'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'txt'=>'text/plain','csv'=>'text/csv',
        ];
        return $map[$ext] ?? 'application/octet-stream';
    }

    private static function randomName(string $ext): string
    {
        $ext = preg_replace('/[^a-zA-Z0-9]/', '', $ext);
        return bin2hex(random_bytes(12)) . ($ext ? ".$ext" : '');
    }
}
