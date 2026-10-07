import React from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { Button, Card } from "../../../components/ui";
import "../homeCards.css";
export function HomeCardFrame({
  type,
  displayVariant = "featured",
  style,
  children
}) {
  return <Card variant="flat" noPadding rounded="3xl" style={style} className={`fc-home-card fc-home-card--${type} fc-home-card--${displayVariant}`}>
    <Card.Content className="fc-home-card-content">{children}</Card.Content>
  </Card>;
}
export function HomeCardHeading({
  icon: Icon,
  children,
  tools
}) {
  return <header className="fc-home-card-heading"><span className="fc-home-icon"><Icon size={23} /></span><h2>{children}</h2>{tools && <div className="fc-home-tools">{tools}</div>}</header>;
}
export function HomeCardAction({
  children,
  onClick,
  icon: Icon = CaretRightIcon
}) {
  return <Button type="button" kind="soft" size="md" onClick={onClick} className="fc-home-action">{children}<Icon size={19} /></Button>;
}
