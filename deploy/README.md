# OCI deployment preparation

These files describe the deployment of the FIRMS Parquet/DuckDB API only. They
do not create OCI resources or deploy the frontend.

## Server layout

Use a read-only service account for the Python process:

```text
/opt/firms-site/.venv
/opt/firms-site/firms_harmonization
/opt/firms-site/data/web-parquet
/opt/firms-site/config/firms-api.env
/var/log/firms-api
```

Copy the repository package and the already-built Parquet dataset onto the VM.
Do not upload the original CSV/SHP archives if only the map API is required.
Create `/var/log/firms-api` if later adding file logging; this service currently
logs to systemd journal.

Install the Python environment on Ubuntu:

```bash
python3 -m venv /opt/firms-site/.venv
/opt/firms-site/.venv/bin/python -m pip install -e ".[test]"
```

Copy and customize `deploy/firms-api.env.example` at
`/opt/firms-site/config/firms-api.env`. `FIRMS_ALLOWED_ORIGINS` must contain the
exact frontend origins, including scheme and host, for example:

```text
https://your-site.example,https://www.example.com
```

Install and start the service:

```bash
sudo cp deploy/firms-data-api.service /etc/systemd/system/firms-data-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now firms-data-api
sudo systemctl status firms-data-api
curl http://127.0.0.1:8000/healthz
```

Expose only HTTPS through a reverse proxy. Keep the Python process bound to
`127.0.0.1`. The included nginx template allows only `/healthz` and
`/api/local-firms/data`; replace `api.example.com` and add valid certificates
before enabling it.

For local testing from a frontend origin, set:

```text
VITE_FIRMS_DATA_MODE=local
VITE_LOCAL_FIRMS_API_URL=https://api.example.com
```

For a future shared backend, `VITE_BACKEND_API_URL` can replace the
frontend-specific data URL. These variables are browser-visible and must never
contain a secret.

## OCI security checklist

- Restrict network security-list and ingress rules to HTTPS plus SSH.
- Do not open port 8000 publicly.
- Create a DNS record for the API only after TLS is ready.
- Keep the VM OS and packages updated.
- Store backups outside the VM or outside the attached boot/data volume.
- Free compute can be reclaimed or unavailable; test and monitor `/healthz`.
- Use at least the OCI boot-volume allowance plus a separate block volume sized
  for the final Parquet dataset and operating system requirements.

## Remaining deployment scope

The current Python API implements FIRMS observations only. Production
deployment still needs:

1. An equivalent `/api/ai/analyze` proxy if COSMO AI is enabled. The COSMO key
   must remain server-only, be stored as an environment secret, and never use
   a `VITE_` variable.
2. An equivalent `/api/harmonized/monthly` endpoint or a deliberate frontend
   unavailable state. The existing Vite implementation reads local processed
   CSV files and is not suitable for a separate public frontend server.
3. The frontend static host and DNS/TLS.
4. A full Parquet build, backup, and initial API load test.
