from typing import Any

import httpx
from fastapi import HTTPException, status

from ..config import get_settings


PLAID_BASE_URLS = {
    "sandbox": "https://sandbox.plaid.com",
    "development": "https://development.plaid.com",
    "production": "https://production.plaid.com",
}


def plaid_configured() -> bool:
    settings = get_settings()
    return bool(settings.plaid_client_id and settings.plaid_secret)


async def plaid_post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    if not plaid_configured():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Plaid is not configured. Add LEDGERLY_PLAID_CLIENT_ID and LEDGERLY_PLAID_SECRET.",
        )

    base_url = PLAID_BASE_URLS.get(settings.plaid_environment, PLAID_BASE_URLS["sandbox"])
    body = {"client_id": settings.plaid_client_id, "secret": settings.plaid_secret, **payload}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{base_url}{path}", json=body)

    if response.status_code >= 400:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=response.text)
    return response.json()


async def create_link_token(user_id: str) -> dict[str, Any]:
    settings = get_settings()
    return await plaid_post(
        "/link/token/create",
        {
            "user": {"client_user_id": user_id},
            "client_name": "Ledgerly",
            "products": settings.plaid_products,
            "country_codes": settings.plaid_country_codes,
            "language": "en",
        },
    )


async def exchange_public_token(public_token: str) -> dict[str, Any]:
    return await plaid_post("/item/public_token/exchange", {"public_token": public_token})


async def sync_transactions(access_token: str, cursor: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"access_token": access_token}
    if cursor:
        payload["cursor"] = cursor
    return await plaid_post("/transactions/sync", payload)
