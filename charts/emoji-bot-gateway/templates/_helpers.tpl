{{/*
Expand the name of the chart.
*/}}
{{- define "emoji-bot-gateway.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "emoji-bot-gateway.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "emoji-bot-gateway.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "emoji-bot-gateway.labels" -}}
helm.sh/chart: {{ include "emoji-bot-gateway.chart" . }}
{{ include "emoji-bot-gateway.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "emoji-bot-gateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "emoji-bot-gateway.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "emoji-bot-gateway.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "emoji-bot-gateway.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Valkey Service Name
*/}}
{{- define "emoji-bot-gateway.valkey.serviceName" -}}
{{- if .Values.valkey.enabled }}
{{- printf "%s-valkey" (include "emoji-bot-gateway.fullname" .) }}
{{- else }}
{{- .Values.externalValkey.host }}
{{- end }}
{{- end }}

{{/*
Valkey Port
*/}}
{{- define "emoji-bot-gateway.valkey.port" -}}
{{- if .Values.valkey.enabled }}
{{- .Values.valkey.service.port }}
{{- else }}
{{- .Values.externalValkey.port }}
{{- end }}
{{- end }}

{{/*
Secret Name
*/}}
{{- define "emoji-bot-gateway.secretName" -}}
{{- if .Values.config.existingSecret }}
{{- .Values.config.existingSecret }}
{{- else }}
{{- printf "%s-secret" (include "emoji-bot-gateway.fullname" .) }}
{{- end }}
{{- end }}
