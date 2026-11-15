# Offizielles Playwright-Image: Chromium + alle Systembibliotheken + xvfb
FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app
RUN pip install --no-cache-dir playwright==1.49.0
COPY dagr_worker ./dagr_worker

ENV DAGR_DATA_DIR=/data \
    DAGR_HEADLESS=0 \
    PYTHONUNBUFFERED=1
VOLUME ["/data"]

# Sichtbarer (nicht-headless) Chromium in einem virtuellen Bildschirm –
# verhält sich wie ein normaler Browser-Besucher.
ENTRYPOINT ["xvfb-run", "-a", "--server-args=-screen 0 1600x1000x24", "python", "-m", "dagr_worker"]
CMD ["loop"]
