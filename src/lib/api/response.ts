import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isAuthError } from "@/modules/identity/errors";
import { isPermissionError } from "@/modules/permissions/permission-errors";
import { isAttachmentError } from "@/modules/attachment/attachment-errors";
import { isEnterpriseError } from "@/modules/enterprise/errors";
import { isDemandError, isDemandLeadError } from "@/modules/demand/errors";
import { isFoundationError } from "@/modules/member-foundation/errors";
import { isPresenceError } from "@/modules/presence/errors";
import { isMapError } from "@/modules/map/errors";
import { isPolicyError } from "@/modules/policy/errors";
import { isTripError } from "@/modules/trip/errors";
import { isTalentError } from "@/modules/talent/errors";
import { isHelpError } from "@/modules/help/errors";
import { isReimbursementError } from "@/modules/reimbursement/errors";
import { isNotificationError } from "@/modules/notification/errors";
import { isAnnouncementError } from "@/modules/announcement/errors";
import { isImportExportError } from "@/modules/import-export/errors";
import { isSystemError } from "@/modules/system/errors";
import { isReportingError } from "@/modules/reporting/errors";
import { writeLog } from "@/lib/logging/logger";

export function apiSuccess<T>(data: T, requestId: string = randomUUID(), status = 200) {
  return NextResponse.json({ ok: true, data, requestId }, { status });
}

export function apiError(error: unknown, requestId: string = randomUUID()) {
  if (isSystemError(error)) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, details: error.details ?? {} }, requestId }, { status: error.status });
  }
  if (isReportingError(error)) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, details: error.details ?? {} }, requestId }, { status: error.status });
  }
  if (isImportExportError(error)) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, details: error.details ?? {} }, requestId }, { status: error.status });
  }
  if (isReimbursementError(error)) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, details: error.details ?? {} }, requestId }, { status: error.status });
  }
  if (isAnnouncementError(error) || isNotificationError(error)) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, details: {} }, requestId }, { status: error.status });
  }
  if (isTripError(error)) {
    return NextResponse.json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details ?? {} },
      requestId,
    }, { status: error.status });
  }
  if (isHelpError(error)) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, details: error.details ?? {} }, requestId }, { status: error.status });
  }
  if (isTalentError(error)) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message, details: error.details ?? {} }, requestId }, { status: error.status });
  }
  if (isPolicyError(error)) {
    return NextResponse.json({
      ok: false,
      error: { code: error.code, message: error.message, details: {} },
      requestId,
    }, { status: error.status });
  }
  if (isFoundationError(error) || isPresenceError(error) || isMapError(error)) {
    return NextResponse.json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details ?? {} },
      requestId,
    }, { status: error.status });
  }
  if (isDemandLeadError(error) || isDemandError(error)) {
    return NextResponse.json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details ?? {} },
      requestId,
    }, { status: error.status });
  }
  if (isEnterpriseError(error)) {
    return NextResponse.json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details ?? {} },
      requestId,
    }, { status: error.status });
  }
  if (isAttachmentError(error)) {
    return NextResponse.json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details ?? {} },
      requestId,
    }, { status: error.status });
  }
  if (isPermissionError(error)) {
    return NextResponse.json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details ?? {} },
      requestId,
    }, { status: error.status });
  }
  if (isAuthError(error)) {
    return NextResponse.json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details ?? {} },
      requestId,
    }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "请求参数不正确", details: error.flatten() },
      requestId,
    }, { status: 400 });
  }
  writeLog("error", {
    requestId,
    module: "api",
    result: "unhandled_error",
    errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
  });
  return NextResponse.json({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "服务暂时不可用", details: {} },
    requestId,
  }, { status: 500 });
}
