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
        bc = re.search(r'</body>', content, re.IGNORECASE)
        if bc:
            content = content[:bc.start()] + '\n' + html_sig + '\n' + content[bc.start():]
        else:
            content = content + '\n' + html_sig
    elif ct == 'text/plain':
        content = content + '\n\n' + text_sig
    else:
        return False

    encoded = quopri.encodestring(content.encode(charset, errors='replace'))
    part.set_payload(encoded.decode('ascii', errors='replace'))
    if 'Content-Transfer-Encoding' in part:
        del part['Content-Transfer-Encoding']
    part['Content-Transfer-Encoding'] = 'quoted-printable'
    return True

def process_msg(msg, html_sig, text_sig):
    if msg.is_multipart():
        modified = False
        for part in msg.get_payload():
            if part.is_multipart():
                if process_msg(part, html_sig, text_sig):
                    modified = True
            elif part.get_content_type() in ('text/html', 'text/plain'):
                if append_to_part(part, html_sig, text_sig):
                    modified = True
        return modified
    elif msg.get_content_type() in ('text/html', 'text/plain'):
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
            smtp = smtplib.SMTP(REINJECT_HOST, REINJECT_PORT)
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
