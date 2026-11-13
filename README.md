# Cindercrest — Website Pendaftaran Tim

Deploy: push folder ini ke GitHub → Netlify "Import from Git" (atau `netlify deploy --prod`).

Environment variables (Netlify → Site configuration → Environment variables):
- ADMIN_PASSWORD  (wajib)  password login panel admin
- SESSION_SECRET  (opsional) string acak panjang

Panel admin: https://domainmu/adminpanelboy
(ganti nama folder site/adminpanelboy untuk mengubah alamatnya)
