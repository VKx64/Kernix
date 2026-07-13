<?php
/**
 * SMTP Mailer — pure PHP, no external dependencies.
 *
 * Supports:
 *  - Plain SMTP, STARTTLS, and implicit SSL (SMTPS)
 *  - LOGIN authentication
 *  - HTML body with plain-text alternative
 *  - Attachments (file paths)
 *  - Multiple recipients (to/cc/bcc)
 *
 * For most cPanel SMTP needs (Gmail, Mailgun, SendGrid, etc.) this is plenty.
 */

class Mailer
{
    /**
     * Send an email and log it to task_emails if task_id provided.
     *
     * @param array $opts {
     *   to: string|array, cc?: string|array, bcc?: string|array,
     *   subject: string, body: string (HTML),
     *   attachments?: [['path'=>..., 'name'=>...], ...],
     *   task_id?: int, sent_by?: int,
     *   reply_to?: string
     * }
     * @return array ['ok'=>bool, 'error'=>?string, 'email_id'=>?int]
     */
    public static function send(array $opts): array
    {
        $taskId = $opts['task_id'] ?? null;
        $sentBy = $opts['sent_by'] ?? Auth::id();

        $emailId = null;
        if ($taskId) {
            $emailId = DB::insert('task_emails', [
                'task_id'       => $taskId,
                'sent_by'       => $sentBy,
                'to_addresses'  => self::flatten($opts['to'] ?? ''),
                'cc_addresses'  => self::flatten($opts['cc'] ?? null),
                'bcc_addresses' => self::flatten($opts['bcc'] ?? null),
                'subject'       => $opts['subject'] ?? '',
                'body'          => $opts['body'] ?? '',
                'status'        => 'queued',
            ]);
        }

        try {
            self::transmit($opts);
            if ($emailId) {
                DB::update('task_emails',
                    ['status' => 'sent', 'sent_at' => date('Y-m-d H:i:s')],
                    ['id' => $emailId]);
            }
            return ['ok' => true, 'error' => null, 'email_id' => $emailId];
        } catch (Throwable $e) {
            if ($emailId) {
                DB::update('task_emails',
                    ['status' => 'failed', 'error_message' => $e->getMessage()],
                    ['id' => $emailId]);
            }
            return ['ok' => false, 'error' => $e->getMessage(), 'email_id' => $emailId];
        }
    }

    private static function transmit(array $opts): void
    {
        $s = settings();
        $host = $s['smtp_host'] ?? '';
        $port = (int)($s['smtp_port'] ?? 587);
        $enc  = $s['smtp_encryption'] ?? 'tls';
        $user = $s['smtp_username'] ?? '';
        $pass = $s['smtp_password'] ?? '';
        $fromEmail = $s['smtp_from_email'] ?? '';
        $fromName  = $s['smtp_from_name']  ?? APP_NAME;

        if (!$host) throw new RuntimeException('SMTP host not configured in Settings.');
        if (!$fromEmail) throw new RuntimeException('SMTP "from" email not configured in Settings.');

        // Build recipients
        $to  = array_filter((array)($opts['to']  ?? []));
        $cc  = array_filter((array)($opts['cc']  ?? []));
        $bcc = array_filter((array)($opts['bcc'] ?? []));
        if (empty($to)) throw new RuntimeException('No recipients.');

        $allRcpt = array_merge($to, $cc, $bcc);

        // Build message
        [$rawHeaders, $rawBody] = self::buildMessage([
            'from_email' => $fromEmail,
            'from_name'  => $fromName,
            'to'         => $to,
            'cc'         => $cc,
            'reply_to'   => $opts['reply_to'] ?? null,
            'subject'    => $opts['subject'] ?? '',
            'body_html'  => $opts['body'] ?? '',
            'attachments'=> $opts['attachments'] ?? [],
        ]);

        // Connect
        $useSSL = ($enc === 'ssl');
        $useTLS = ($enc === 'tls');
        $remote = ($useSSL ? 'ssl://' : '') . $host . ':' . $port;

        $context = stream_context_create(['ssl' => [
            'verify_peer' => true, 'verify_peer_name' => true, 'allow_self_signed' => false,
        ]]);
        $errno = 0; $errstr = '';
        $sock = @stream_socket_client($remote, $errno, $errstr, 30, STREAM_CLIENT_CONNECT, $context);
        if (!$sock) throw new RuntimeException("SMTP connect failed: $errstr");
        stream_set_timeout($sock, 30);

        try {
            self::expect($sock, 220);
            self::cmd($sock, 'EHLO ' . self::clientHostname(), 250);

            if ($useTLS) {
                self::cmd($sock, 'STARTTLS', 220);
                if (!stream_socket_enable_crypto($sock, true,
                    STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                    throw new RuntimeException('STARTTLS handshake failed.');
                }
                self::cmd($sock, 'EHLO ' . self::clientHostname(), 250);
            }

            if ($user !== '') {
                self::cmd($sock, 'AUTH LOGIN', 334);
                self::cmd($sock, base64_encode($user), 334);
                self::cmd($sock, base64_encode($pass), 235);
            }

            self::cmd($sock, 'MAIL FROM:<' . $fromEmail . '>', 250);
            foreach ($allRcpt as $rcpt) {
                self::cmd($sock, 'RCPT TO:<' . self::addrOnly($rcpt) . '>', [250, 251]);
            }
            self::cmd($sock, 'DATA', 354);

            // Headers + body, end with <CRLF>.<CRLF>
            fwrite($sock, $rawHeaders . "\r\n\r\n" . self::dotStuff($rawBody) . "\r\n.\r\n");
            self::expect($sock, 250);
            self::cmd($sock, 'QUIT', [221, 250]);
        } finally {
            @fclose($sock);
        }
    }

    // ---------- Message builder ----------
    private static function buildMessage(array $m): array
    {
        $boundaryMixed = '=_mix_' . bin2hex(random_bytes(8));
        $boundaryAlt   = '=_alt_' . bin2hex(random_bytes(8));

        $headers = [];
        $headers[] = 'Date: ' . date('r');
        $headers[] = 'From: ' . self::formatAddr($m['from_email'], $m['from_name']);
        $headers[] = 'To: ' . implode(', ', array_map([self::class, 'formatAddrRaw'], $m['to']));
        if (!empty($m['cc'])) $headers[] = 'Cc: ' . implode(', ', array_map([self::class, 'formatAddrRaw'], $m['cc']));
        if (!empty($m['reply_to'])) $headers[] = 'Reply-To: ' . self::formatAddrRaw($m['reply_to']);
        $headers[] = 'Subject: ' . self::encodeHeader($m['subject']);
        $headers[] = 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . self::clientHostname() . '>';
        $headers[] = 'MIME-Version: 1.0';

        $hasAttach = !empty($m['attachments']);
        if ($hasAttach) {
            $headers[] = 'Content-Type: multipart/mixed; boundary="' . $boundaryMixed . '"';
        } else {
            $headers[] = 'Content-Type: multipart/alternative; boundary="' . $boundaryAlt . '"';
        }

        // Build body parts
        $html = $m['body_html'];
        $text = trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));

        $altPart  = "--$boundaryAlt\r\n";
        $altPart .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $altPart .= "Content-Transfer-Encoding: quoted-printable\r\n\r\n";
        $altPart .= quoted_printable_encode($text) . "\r\n";
        $altPart .= "--$boundaryAlt\r\n";
        $altPart .= "Content-Type: text/html; charset=UTF-8\r\n";
        $altPart .= "Content-Transfer-Encoding: quoted-printable\r\n\r\n";
        $altPart .= quoted_printable_encode($html) . "\r\n";
        $altPart .= "--$boundaryAlt--\r\n";

        if (!$hasAttach) {
            return [implode("\r\n", $headers), $altPart];
        }

        $body  = "--$boundaryMixed\r\n";
        $body .= "Content-Type: multipart/alternative; boundary=\"$boundaryAlt\"\r\n\r\n";
        $body .= $altPart . "\r\n";

        foreach ($m['attachments'] as $att) {
            $path = $att['path'];
            $name = $att['name'] ?? basename($path);
            if (!is_readable($path)) continue;
            $data = base64_encode(file_get_contents($path));
            $mime = function_exists('mime_content_type') ? (mime_content_type($path) ?: 'application/octet-stream') : 'application/octet-stream';

            $body .= "--$boundaryMixed\r\n";
            $body .= "Content-Type: $mime; name=\"" . self::encodeHeader($name) . "\"\r\n";
            $body .= "Content-Transfer-Encoding: base64\r\n";
            $body .= "Content-Disposition: attachment; filename=\"" . self::encodeHeader($name) . "\"\r\n\r\n";
            $body .= chunk_split($data, 76, "\r\n");
        }
        $body .= "--$boundaryMixed--\r\n";

        return [implode("\r\n", $headers), $body];
    }

    // ---------- SMTP helpers ----------
    private static function cmd($sock, string $command, $expect): string
    {
        fwrite($sock, $command . "\r\n");
        return self::expect($sock, $expect);
    }

    private static function expect($sock, $expect): string
    {
        $expect = (array)$expect;
        $response = '';
        while (($line = fgets($sock, 1024)) !== false) {
            $response .= $line;
            if (isset($line[3]) && $line[3] === ' ') break;
        }
        $code = (int)substr($response, 0, 3);
        if (!in_array($code, $expect, true)) {
            throw new RuntimeException("SMTP error: expected " . implode('/', $expect) . ", got: " . trim($response));
        }
        return $response;
    }

    private static function dotStuff(string $body): string
    {
        return preg_replace('/^\./m', '..', $body);
    }

    private static function clientHostname(): string
    {
        $h = $_SERVER['SERVER_NAME'] ?? gethostname() ?: 'localhost';
        return preg_replace('/[^a-zA-Z0-9.\-]/', '', $h);
    }

    private static function formatAddr(string $email, ?string $name = null): string
    {
        $email = self::addrOnly($email);
        return $name ? self::encodeHeader($name) . ' <' . $email . '>' : '<' . $email . '>';
    }

    private static function formatAddrRaw(string $raw): string
    {
        // Accepts "Name <email>" or "email"
        return trim($raw);
    }

    private static function addrOnly(string $raw): string
    {
        if (preg_match('/<([^>]+)>/', $raw, $m)) return trim($m[1]);
        return trim($raw);
    }

    private static function encodeHeader(string $value): string
    {
        if (preg_match('/[^\x20-\x7E]/', $value)) {
            return '=?UTF-8?B?' . base64_encode($value) . '?=';
        }
        return $value;
    }

    private static function flatten($addr): ?string
    {
        if ($addr === null || $addr === '') return null;
        if (is_array($addr)) return implode(', ', array_filter($addr));
        return (string)$addr;
    }
}
