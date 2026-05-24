from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from ..dependencies import get_user_id
from ..schemas import ReceiptParseResponse
from ..services.receipt_parser import parse_receipt_image, parse_receipt_text

router = APIRouter(prefix="/receipts", tags=["receipts"])


@router.post("/parse", response_model=ReceiptParseResponse)
async def parse_receipt(
    user_id: Annotated[str, Depends(get_user_id)],
    file: UploadFile = File(...),
    note: str = Form(default=""),
) -> ReceiptParseResponse:
    content = await file.read()
    content_type = file.content_type or "application/octet-stream"
    file_name = file.filename or ""
    if content_type.startswith("text/") or file_name.lower().endswith((".txt", ".csv")):
        return parse_receipt_text(content.decode("utf-8-sig", errors="ignore"), note)
    if not content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Receipt parsing currently supports text files and image uploads.",
        )
    return await parse_receipt_image(content, content_type, note)
