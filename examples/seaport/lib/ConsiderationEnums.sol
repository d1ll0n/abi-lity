pragma solidity ^0.8.7;

enum OrderType { FULL_OPEN, PARTIAL_OPEN, FULL_RESTRICTED, PARTIAL_RESTRICTED, CONTRACT }

enum BasicOrderType { ETH_TO_ERC721_FULL_OPEN, ETH_TO_ERC721_PARTIAL_OPEN, ETH_TO_ERC721_FULL_RESTRICTED, ETH_TO_ERC721_PARTIAL_RESTRICTED, ETH_TO_ERC1155_FULL_OPEN, ETH_TO_ERC1155_PARTIAL_OPEN, ETH_TO_ERC1155_FULL_RESTRICTED, ETH_TO_ERC1155_PARTIAL_RESTRICTED, ERC20_TO_ERC721_FULL_OPEN, ERC20_TO_ERC721_PARTIAL_OPEN, ERC20_TO_ERC721_FULL_RESTRICTED, ERC20_TO_ERC721_PARTIAL_RESTRICTED, ERC20_TO_ERC1155_FULL_OPEN, ERC20_TO_ERC1155_PARTIAL_OPEN, ERC20_TO_ERC1155_FULL_RESTRICTED, ERC20_TO_ERC1155_PARTIAL_RESTRICTED, ERC721_TO_ERC20_FULL_OPEN, ERC721_TO_ERC20_PARTIAL_OPEN, ERC721_TO_ERC20_FULL_RESTRICTED, ERC721_TO_ERC20_PARTIAL_RESTRICTED, ERC1155_TO_ERC20_FULL_OPEN, ERC1155_TO_ERC20_PARTIAL_OPEN, ERC1155_TO_ERC20_FULL_RESTRICTED, ERC1155_TO_ERC20_PARTIAL_RESTRICTED }

enum BasicOrderRouteType { ETH_TO_ERC721, ETH_TO_ERC1155, ERC20_TO_ERC721, ERC20_TO_ERC1155, ERC721_TO_ERC20, ERC1155_TO_ERC20 }

enum ItemType { NATIVE, ERC20, ERC721, ERC1155, ERC721_WITH_CRITERIA, ERC1155_WITH_CRITERIA }

enum Side { OFFER, CONSIDERATION }