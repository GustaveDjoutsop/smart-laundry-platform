{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "spring-bot-manager.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "spring-bot-manager.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default .Values.app .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
