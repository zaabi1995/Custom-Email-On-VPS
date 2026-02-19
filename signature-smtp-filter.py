#!/usr/bin/env python3
"""
SMTP-based content filter for Postfix.
Listens on port 10024, appends email signatures, reinjects on port 10025.
"""

import asyncio
import email
import re
import json
import logging
import quopri
import smtplib
import urllib.request
import urllib.parse
from aiosmtpd.controller import Controller
from aiosmtpd.smtp import SMTP

API_URL = "http://127.0.0.1:3456/email-signature/api/signature/"

EMAIL_DISCLAIMER_HTML = '''<div style="font-family: Arial, sans-serif; font-size: 10px; color: #999; margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd; max-width: 500px; line-height: 1.5;">
<p style="margin: 0 0 8px 0;">This email and any attachments are intended solely for the recipient(s) named above and may contain confidential or privileged information. If you are not the intended recipient or have received this email in error, please notify the sender immediately and delete it from your system. Any unauthorized copying, disclosure, or distribution of the material in this email is strictly forbidden.</p>
<p style="margin: 0;"><img src="https://alali.om/email-signature/uploads/leaf-icon.png" alt="leaf" style="vertical-align: middle; width: 14px; height: 14px;"> Please consider the environment before printing this email.</p>
</div>'''

EMAIL_DISCLAIMER_TEXT = """
---
This email and any attachments are intended solely for the recipient(s) named above and may contain confidential or privileged information. If you are not the intended recipient or have received this email in error, please notify the sender immediately and delete it from your system. Any unauthorized copying, disclosure, or distribution of the material in this email is strictly forbidden.
* Please consider the environment before printing this email."""
REINJECT_HOST = "127.0.0.1"
REINJECT_PORT = 10025
LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 10024
LOG_FILE = "/var/log/signature-filter.log"

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

def get_signature(sender_email):
    try:
        clean = sender_email.strip().lower()
        if '<' in clean:
            clean = clean.split('<')[1].split('>')[0]
        url = API_URL + urllib.parse.quote(clean)
        req = urllib.request.Request(url, headers={'User-Agent': 'SigFilter/1.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            if data.get('found'):
                return data.get('html', '')
    except Exception as e:
        logger.error(f"API error for {sender_email}: {e}")
    return None

def plain_text_from_html(html):
    text = re.sub(r'<br\s*/?>', '\n', html)
    text = re.sub(r'<hr[^>]*>', '\n' + '-' * 40 + '\n', text)
    text = re.sub(r'<p[^>]*>', '\n', text)
    text = re.sub(r'</p>', '', text)
    text = re.sub(r'<a[^>]*href="([^"]*)"[^>]*>([^<]*)</a>', r'\2 (\1)', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def append_to_part(part, html_sig, text_sig):
    ct = part.get_content_type()
    charset = part.get_content_charset() or 'utf-8'
    try:
        payload = part.get_payload(decode=True)
        if not payload:
            return False
        content = payload.decode(charset, errors='replace')
    except:
        return False

    if 'alali investment spc' in content.lower():
        return False

    if ct == 'text/html':
        sig_block = '\n' + html_sig + '\n' + EMAIL_DISCLAIMER_HTML + '\n'
        # Try to insert BEFORE the quoted reply chain (not at the very bottom)
        # Outlook uses a div with border-top:solid as the reply separator
        reply_marker = re.search(
            r'<div[^>]*style=["\'][^"\']*border-top:\s*solid\s+#[0-9a-fA-F]{6}',
            content, re.IGNORECASE
        )
        if reply_marker:
            # Walk back to find the parent <div> that wraps the entire reply block
            # Insert signature just before the reply separator div
            insert_pos = reply_marker.start()
            content = content[:insert_pos] + sig_block + content[insert_pos:]
        else:
            # No reply chain — insert before </body> as usual
            bc = re.search(r'</body>', content, re.IGNORECASE)
            if bc:
                content = content[:bc.start()] + sig_block + content[bc.start():]
            else:
                content = content + sig_block
    elif ct == 'text/plain':
        # For plain text, insert before the reply marker line (e.g. "From:" or "-----Original Message-----")
        reply_text_marker = re.search(
            r'\n\s*(?:-----\s*Original Message\s*-----|-{2,}\s*Forwarded|From:\s+.*@)',
            content
        )
        if reply_text_marker:
            insert_pos = reply_text_marker.start()
            content = content[:insert_pos] + '\n\n' + text_sig + '\n' + EMAIL_DISCLAIMER_TEXT + '\n' + content[insert_pos:]
        else:
            content = content + '\n\n' + text_sig + '\n' + EMAIL_DISCLAIMER_TEXT
    else:
        return False

    # Always use UTF-8 after appending signature (may contain Arabic)
    encoded = quopri.encodestring(content.encode('utf-8', errors='replace'))
    part.set_payload(encoded.decode('ascii', errors='replace'))
    part.set_charset(None)
    if 'Content-Transfer-Encoding' in part:
        del part['Content-Transfer-Encoding']
    part['Content-Transfer-Encoding'] = 'quoted-printable'
    if 'Content-Type' in part:
        ct = part['Content-Type']
        # Replace charset with utf-8
        import re as _re
        if 'charset' in ct.lower():
            new_ct = _re.sub(r'charset=[^\s;]+', 'charset=utf-8', ct, flags=_re.IGNORECASE)
        else:
            new_ct = ct.rstrip(';') + '; charset=utf-8'
        del part['Content-Type']
        part['Content-Type'] = new_ct
    return True

def convert_plain_to_html_part(part):
    """Convert a text/plain part to text/html so the HTML signature renders properly."""
    charset = part.get_content_charset() or 'utf-8'
    try:
        payload = part.get_payload(decode=True)
        if not payload:
            return False
        content = payload.decode(charset, errors='replace')
    except:
        return False
    # Escape HTML entities and convert newlines to <br>
    import html as html_mod
    escaped = html_mod.escape(content)
    escaped = escaped.replace('\n', '<br>\n')
    html_body = (
        '<html><body>'
        '<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">'
        f'{escaped}'
        '</div>'
        '</body></html>'
    )
    encoded = quopri.encodestring(html_body.encode('utf-8', errors='replace'))
    part.set_payload(encoded.decode('ascii', errors='replace'))
    part.set_type('text/html')
    # Force UTF-8 charset
    if 'Content-Type' in part:
        del part['Content-Type']
    part['Content-Type'] = 'text/html; charset=utf-8'
    if 'Content-Transfer-Encoding' in part:
        del part['Content-Transfer-Encoding']
    part['Content-Transfer-Encoding'] = 'quoted-printable'
    return True

def process_msg(msg, html_sig, text_sig):
    ct = msg.get_content_type()

    if ct == 'multipart/alternative':
        # Handle multipart/alternative correctly:
        # Keep text/plain as text/plain, only append text sig
        # Keep text/html as text/html, append HTML sig
        # NEVER convert text/plain → text/html here (breaks Outlook)
        modified = False
        for part in msg.get_payload():
            if part.get_content_type() == 'text/html':
                if append_to_part(part, html_sig, text_sig):
                    modified = True
            elif part.get_content_type() == 'text/plain':
                if append_to_part(part, html_sig, text_sig):
                    modified = True
        return modified

    elif msg.is_multipart():
        modified = False
        for part in msg.get_payload():
            if process_msg(part, html_sig, text_sig):
                modified = True
        return modified

    elif ct == 'text/plain':
        # Single plain-text email (no multipart) — convert to HTML then append
        convert_plain_to_html_part(msg)
        return append_to_part(msg, html_sig, text_sig)

    elif ct == 'text/html':
        return append_to_part(msg, html_sig, text_sig)

    return False

class SignatureHandler:
    async def handle_DATA(self, server, session, envelope):
        sender = envelope.mail_from or ''
        recipients = envelope.rcpt_tos
        raw_data = envelope.content

        if isinstance(raw_data, str):
            raw_data = raw_data.encode()

        logger.info(f"Processing: from={sender} to={recipients}")

        # Parse and process
        try:
            msg = email.message_from_bytes(raw_data)
            
            sender_clean = sender.strip().lower().strip('<>')
            html_sig = get_signature(sender_clean)
            
            if html_sig:
                text_sig = plain_text_from_html(html_sig)
                if process_msg(msg, html_sig, text_sig):
                    raw_data = msg.as_bytes()
                    logger.info(f"Signature appended for {sender_clean}")
                else:
                    logger.info(f"No modification needed for {sender_clean}")
            else:
                logger.info(f"No signature for {sender_clean}, passing through")
        except Exception as e:
            logger.error(f"Error processing: {e}")

        # Reinject via port 10025
        try:
            smtp = smtplib.SMTP(REINJECT_HOST, REINJECT_PORT, timeout=30)
            smtp.sendmail(sender, recipients, raw_data)
            smtp.quit()
            logger.info(f"Reinjected successfully")
            return '250 OK'
        except Exception as e:
            logger.error(f"Reinject error: {e}")
            return '451 Temporary error, please retry'

def main():
    handler = SignatureHandler()
    controller = Controller(
        handler,
        hostname=LISTEN_HOST,
        port=LISTEN_PORT,
        server_hostname='signature-filter',
        decode_data=False
    )
    logger.info(f"Starting SMTP signature filter on {LISTEN_HOST}:{LISTEN_PORT}")
    print(f"Signature SMTP filter starting on {LISTEN_HOST}:{LISTEN_PORT}")
    controller.start()
    
    import signal
    def shutdown(sig, frame):
        logger.info("Shutting down")
        controller.stop()
        exit(0)
    
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    
    # Keep running
    import time
    while True:
        time.sleep(1)

if __name__ == '__main__':
    main()
