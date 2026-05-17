from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_user_id
from ..schemas import PurchaseDecisionRequest, PurchaseDecisionResponse
from ..services.decisions import make_purchase_decision

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.post("/purchase", response_model=PurchaseDecisionResponse)
def purchase_decision(
    payload: PurchaseDecisionRequest,
    user_id: Annotated[str, Depends(get_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> PurchaseDecisionResponse:
    return make_purchase_decision(db, user_id, payload.category_name, payload.amount, payload.date)
