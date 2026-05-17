from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_user_id
from ..models import BankConnection
from ..schemas import BankSyncRequest, BankSyncResponse

router = APIRouter(prefix="/bank-sync", tags=["bank-sync"])


@router.post("/sync", response_model=BankSyncResponse)
def sync_bank_account(
    payload: BankSyncRequest,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> BankSyncResponse:
    connection = BankConnection(
        user_id=user_id,
        provider=payload.provider,
        external_item_id=payload.connection_id,
        status="not_configured",
    )
    db.add(connection)
    db.commit()

    return BankSyncResponse(
        status="not_configured",
        provider=payload.provider,
        message="Bank sync endpoint is reserved, but no banking aggregator is configured yet.",
        next_step="Add a provider integration such as Plaid or Teller, then exchange the public token server-side.",
    )
